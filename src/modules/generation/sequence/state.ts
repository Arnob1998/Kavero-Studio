import type {
  BeginSequenceAttemptResult,
  SequenceAttempt,
  SequenceFrameId,
  SequenceOutputId,
  SequenceOutputLineage,
  SequencePersistenceRecord,
} from "./contracts";
import { SEQUENCE_PRODUCT_LIMITS } from "./limits";

function activeRevision(record: SequencePersistenceRecord) {
  return record.planRevisions.find((revision) => revision.id === record.execution.activePlanRevisionId) ?? null;
}

function patchActiveFrame(
  record: SequencePersistenceRecord,
  frameId: SequenceFrameId,
  patch: (frame: NonNullable<ReturnType<typeof activeRevision>>["frames"][number]) => NonNullable<ReturnType<typeof activeRevision>>["frames"][number],
  updatedAt: string,
) {
  const revisionIndex = record.planRevisions.findIndex((revision) => revision.id === record.execution.activePlanRevisionId);
  if (revisionIndex < 0) return record;
  const revision = record.planRevisions[revisionIndex];
  const frameIndex = revision.frames.findIndex((frame) => frame.id === frameId);
  if (frameIndex < 0) return record;
  const frames = [...revision.frames];
  frames[frameIndex] = patch(frames[frameIndex]);
  const planRevisions = [...record.planRevisions];
  planRevisions[revisionIndex] = { ...revision, frames };
  return { ...record, planRevisions, updatedAt };
}

function nextIncompleteFrameId(record: SequencePersistenceRecord) {
  const revision = activeRevision(record);
  return revision?.frames
    .slice()
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    .find((frame) => frame.status !== "accepted")?.id ?? null;
}

export function beginSequenceExecution(record: SequencePersistenceRecord, startedAt: string): SequencePersistenceRecord {
  const revision = activeRevision(record);
  if (!revision?.approvedAt) return record;
  if (record.execution.status === "complete") return record;
  return {
    ...record,
    version: record.version + 1,
    updatedAt: startedAt,
    execution: {
      ...record.execution,
      status: "running",
      nextFrameId: nextIncompleteFrameId(record),
      cancelRequestedAt: null,
      lastUpdatedAt: startedAt,
    },
  };
}

export function beginSequenceAttempt(input: {
  record: SequencePersistenceRecord;
  frameId: SequenceFrameId;
  attemptId: string;
  startedAt: string;
  replacesOutputId?: SequenceOutputId | null;
}): BeginSequenceAttemptResult {
  const { record } = input;
  if (record.execution.status !== "running") return { ok: false, reason: "record-not-running" };
  if (record.execution.cancelRequestedAt) return { ok: false, reason: "cancellation-requested" };
  const revision = activeRevision(record);
  if (!revision?.approvedAt) return { ok: false, reason: "plan-not-approved" };
  const frame = revision.frames.find((candidate) => candidate.id === input.frameId);
  if (!frame) return { ok: false, reason: "frame-not-found" };
  if (frame.dependencies.some((dependency) => revision.frames.find((candidate) => candidate.id === dependency.frameId)?.status !== "accepted")) {
    return { ok: false, reason: "dependencies-incomplete" };
  }
  if (frame.status === "accepted" && !input.replacesOutputId) return { ok: false, reason: "frame-already-complete" };
  const latestAttempt = frame.attemptIds.length > 0
    ? record.attempts.find((candidate) => candidate.id === frame.attemptIds[frame.attemptIds.length - 1])
    : null;
  if (frame.status === "failed" && latestAttempt && !latestAttempt.retryable) {
    return { ok: false, reason: "frame-not-retryable" };
  }
  if (frame.attemptIds.length >= SEQUENCE_PRODUCT_LIMITS.maximumRetryAttemptsPerFrame) {
    return { ok: false, reason: "frame-attempt-limit" };
  }
  if (record.execution.imageCallsUsed >= SEQUENCE_PRODUCT_LIMITS.maximumImageCalls) {
    return { ok: false, reason: "image-call-limit" };
  }
  const running = record.attempts.filter((attempt) => attempt.status === "running").length;
  if (running >= SEQUENCE_PRODUCT_LIMITS.maximumConcurrentImageCalls) {
    return { ok: false, reason: "concurrency-limit" };
  }

  const attempt: SequenceAttempt = {
    id: input.attemptId,
    frameId: frame.id,
    planRevisionId: revision.id,
    attemptNumber: frame.attemptIds.length + 1,
    status: "running",
    startedAt: input.startedAt,
    finishedAt: null,
    outputId: null,
    replacesOutputId: input.replacesOutputId ?? null,
    errorCode: null,
    retryable: false,
  };
  let next = patchActiveFrame(record, frame.id, (current) => ({
    ...current,
    status: "running",
    attemptIds: [...current.attemptIds, attempt.id],
  }), input.startedAt);
  next = {
    ...next,
    version: record.version + 1,
    attempts: [...record.attempts, attempt],
    execution: {
      ...record.execution,
      imageCallsUsed: record.execution.imageCallsUsed + 1,
      nextFrameId: frame.id,
      lastUpdatedAt: input.startedAt,
    },
  };
  return { ok: true, record: next, attempt };
}

export function succeedSequenceAttempt(input: {
  record: SequencePersistenceRecord;
  attemptId: string;
  output: SequenceOutputLineage;
  finishedAt: string;
}): SequencePersistenceRecord {
  const attempt = input.record.attempts.find((candidate) => candidate.id === input.attemptId);
  if (!attempt || attempt.status !== "running" || input.output.attemptId !== attempt.id || input.output.frameId !== attempt.frameId) {
    return input.record;
  }
  const attempts = input.record.attempts.map((candidate) => candidate.id === attempt.id ? {
    ...candidate,
    status: "succeeded" as const,
    finishedAt: input.finishedAt,
    outputId: input.output.id,
    retryable: false,
  } : candidate);
  let next: SequencePersistenceRecord = {
    ...input.record,
    attempts,
    outputs: [...input.record.outputs, input.output],
  };
  next = acceptSequenceOutput({ record: next, frameId: attempt.frameId, outputId: input.output.id, acceptedAt: input.finishedAt });
  const nextFrameId = nextIncompleteFrameId(next);
  const cancellationRequested = Boolean(next.execution.cancelRequestedAt);
  return {
    ...next,
    execution: {
      ...next.execution,
      status: cancellationRequested ? "cancelled" : nextFrameId ? "running" : "complete",
      nextFrameId,
      lastUpdatedAt: input.finishedAt,
    },
  };
}

export function failSequenceAttempt(input: {
  record: SequencePersistenceRecord;
  attemptId: string;
  finishedAt: string;
  errorCode: string;
  retryable: boolean;
}): SequencePersistenceRecord {
  const attempt = input.record.attempts.find((candidate) => candidate.id === input.attemptId);
  if (!attempt || attempt.status !== "running") return input.record;
  const attempts = input.record.attempts.map((candidate) => candidate.id === attempt.id ? {
    ...candidate,
    status: "failed" as const,
    finishedAt: input.finishedAt,
    errorCode: input.errorCode,
    retryable: input.retryable,
  } : candidate);
  const cancellationRequested = Boolean(input.record.execution.cancelRequestedAt);
  const acceptedCount = activeRevision(input.record)?.frames.filter((frame) => frame.status === "accepted").length ?? 0;
  let next = patchActiveFrame(input.record, attempt.frameId, (frame) => ({
    ...frame,
    status: cancellationRequested ? "cancelled" : "failed",
  }), input.finishedAt);
  next = {
    ...next,
    version: input.record.version + 1,
    attempts,
    execution: {
      ...input.record.execution,
      status: cancellationRequested ? "cancelled" : acceptedCount > 0 ? "partially-complete" : "failed",
      nextFrameId: attempt.frameId,
      lastUpdatedAt: input.finishedAt,
    },
  };
  return next;
}

export function requestSequenceCancellation(record: SequencePersistenceRecord, requestedAt: string): SequencePersistenceRecord {
  if (record.execution.status !== "running" || record.execution.cancelRequestedAt) return record;
  const hasRunningAttempt = record.attempts.some((attempt) => attempt.status === "running");
  return {
    ...record,
    version: record.version + 1,
    updatedAt: requestedAt,
    execution: {
      ...record.execution,
      status: hasRunningAttempt ? "running" : "cancelled",
      cancelRequestedAt: requestedAt,
      lastUpdatedAt: requestedAt,
    },
  };
}

export function resumeSequenceExecution(record: SequencePersistenceRecord, resumedAt: string): SequencePersistenceRecord {
  if (!["failed", "partially-complete", "cancelled"].includes(record.execution.status)) return record;
  const revision = activeRevision(record);
  if (!revision?.approvedAt) return record;
  const blockedFailure = revision.frames.some((frame) => {
    if (frame.status !== "failed") return false;
    const latestAttemptId = frame.attemptIds[frame.attemptIds.length - 1];
    const latestAttempt = record.attempts.find((attempt) => attempt.id === latestAttemptId);
    return !latestAttempt?.retryable || frame.attemptIds.length >= SEQUENCE_PRODUCT_LIMITS.maximumRetryAttemptsPerFrame;
  });
  if (blockedFailure) return record;
  const planRevisions = record.planRevisions.map((candidate) => candidate.id !== revision.id ? candidate : {
    ...candidate,
    frames: candidate.frames.map((frame) => frame.status === "failed" || frame.status === "cancelled"
      ? { ...frame, status: "pending" as const }
      : frame),
  });
  const next = { ...record, planRevisions };
  return {
    ...next,
    version: record.version + 1,
    updatedAt: resumedAt,
    execution: {
      ...record.execution,
      status: "running",
      cancelRequestedAt: null,
      nextFrameId: nextIncompleteFrameId(next),
      lastUpdatedAt: resumedAt,
    },
  };
}

export function appendSequenceAttempt(
  record: SequencePersistenceRecord,
  attempt: SequenceAttempt,
): SequencePersistenceRecord {
  if (record.attempts.some((current) => current.id === attempt.id)) return record;
  return {
    ...record,
    version: record.version + 1,
    updatedAt: attempt.startedAt ?? record.updatedAt,
    attempts: [...record.attempts, attempt],
  };
}

export function appendSequenceOutput(
  record: SequencePersistenceRecord,
  output: SequenceOutputLineage,
): SequencePersistenceRecord {
  if (record.outputs.some((current) => current.id === output.id)) return record;
  return {
    ...record,
    version: record.version + 1,
    updatedAt: output.createdAt,
    outputs: [...record.outputs, output],
  };
}

export function acceptSequenceOutput(input: {
  record: SequencePersistenceRecord;
  frameId: SequenceFrameId;
  outputId: SequenceOutputId;
  acceptedAt: string;
}): SequencePersistenceRecord {
  const output = input.record.outputs.find((candidate) => candidate.id === input.outputId && candidate.frameId === input.frameId);
  if (!output) return input.record;
  const revisionIndex = input.record.planRevisions.findIndex((revision) => revision.id === input.record.execution.activePlanRevisionId);
  if (revisionIndex < 0) return input.record;

  const revision = input.record.planRevisions[revisionIndex];
  const frameIndex = revision.frames.findIndex((frame) => frame.id === input.frameId);
  if (frameIndex < 0) return input.record;
  const frame = revision.frames[frameIndex];

  const frames = [...revision.frames];
  frames[frameIndex] = { ...frame, status: "accepted", acceptedOutputId: input.outputId };
  const revisions = [...input.record.planRevisions];
  revisions[revisionIndex] = { ...revision, frames };

  return {
    ...input.record,
    version: input.record.version + 1,
    updatedAt: input.acceptedAt,
    planRevisions: revisions,
    outputs: input.record.outputs.map((candidate) =>
      candidate.id === input.outputId ? { ...candidate, acceptedAt: input.acceptedAt } : candidate,
    ),
  };
}
