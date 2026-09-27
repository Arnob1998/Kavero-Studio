import { describe, expect, it } from "vitest";
import {
  acceptSequenceOutput,
  appendSequenceAttempt,
  appendSequenceOutput,
  beginSequenceAttempt,
  beginSequenceExecution,
  buildSequenceFramePrompt,
  calculateAffectedFrameIds,
  failSequenceAttempt,
  requestSequenceCancellation,
  resumeSequenceExecution,
  selectSequenceReferences,
  SEQUENCE_PRODUCT_LIMITS,
  succeedSequenceAttempt,
  validateSequenceCapabilities,
} from ".";
import type {
  SequenceAttempt,
  SequenceFrame,
  SequenceOutputLineage,
  SequencePersistenceRecord,
  SequenceReference,
} from ".";

const source = {
  kind: "upload",
  assetId: "asset",
  mimeType: "image/png",
  byteSize: 100,
  sourceSequenceId: null,
  sourceFrameId: null,
  sourceOutputId: null,
} as const;

function frame(
  id: string,
  position: number,
  referenceIds: readonly string[] = [],
  dependencies: SequenceFrame["dependencies"] = [],
): SequenceFrame {
  return {
    id,
    position,
    purpose: `Purpose ${id}`,
    prompt: `Prompt ${id}`,
    referenceIds,
    dependencies,
    status: "pending",
    attemptIds: [],
    acceptedOutputId: null,
  };
}

function reference(
  id: string,
  order: number,
  role: SequenceReference["role"],
  frameIds: readonly string[] = [],
): SequenceReference {
  return { id, order, role, frameIds, label: id, source: { ...source, assetId: id } };
}

function output(overrides: Partial<SequenceOutputLineage> = {}): SequenceOutputLineage {
  return {
    id: "output-1",
    sequenceId: "sequence-1",
    frameId: "frame-1",
    planRevisionId: "revision-1",
    attemptId: "attempt-1",
    generatedImageId: "generated-1",
    modelAlias: "kavero-image-generation-default",
    prompt: "Prompt",
    referenceIds: [],
    sourceOutputIds: [],
    createdAt: "2026-09-12T10:00:00.000Z",
    acceptedAt: "2026-09-12T10:01:00.000Z",
    supersedesOutputId: null,
    ...overrides,
  };
}

describe("sequence capability foundation", () => {
  it("fails closed for unverified planners and unknown image models", () => {
    expect(validateSequenceCapabilities({
      plannerModelAlias: "kavero-chat-openai-gpt-5-6",
      imageModelAlias: "missing-image-model",
    }).map((issue) => issue.code)).toEqual(["planner-not-eligible", "unknown-image-model"]);
  });

  it("accepts verified text-only planning and gates reference-assisted execution", () => {
    expect(validateSequenceCapabilities({
      plannerModelAlias: "kavero-chat-orchestration-default",
      imageModelAlias: "kavero-image-openai-gpt-image-2",
    })).toEqual([]);

    expect(validateSequenceCapabilities({
      plannerModelAlias: "kavero-chat-orchestration-default",
      imageModelAlias: "kavero-image-openai-gpt-image-2",
      executionUsesReferences: true,
    })).toEqual([expect.objectContaining({ code: "image-references-unavailable" })]);
  });

  it("enforces browser-safe planner image MIME, count, and byte caps", () => {
    const issues = validateSequenceCapabilities({
      plannerModelAlias: "kavero-chat-orchestration-default",
      imageModelAlias: "kavero-image-generation-default",
      plannerImages: [
        ...Array.from({ length: 8 }, () => ({ mimeType: "image/png", byteSize: 4 * 1024 * 1024 })),
        { mimeType: "image/gif", byteSize: 11 * 1024 * 1024 },
      ],
    });
    expect(issues.map((issue) => issue.code)).toEqual([
      "too-many-planner-images",
      "unsupported-planner-image-type",
      "planner-image-too-large",
      "planner-images-too-large",
    ]);
  });

  it("keeps product budgets finite and internally consistent", () => {
    expect(SEQUENCE_PRODUCT_LIMITS.maximumFrames).toBeGreaterThan(1);
    expect(SEQUENCE_PRODUCT_LIMITS.maximumUploads).toBeGreaterThanOrEqual(SEQUENCE_PRODUCT_LIMITS.maximumFrames);
    expect(SEQUENCE_PRODUCT_LIMITS.maximumImageCalls).toBeGreaterThanOrEqual(SEQUENCE_PRODUCT_LIMITS.maximumFrames);
    expect(SEQUENCE_PRODUCT_LIMITS.maximumRetryAttemptsPerFrame).toBeLessThan(SEQUENCE_PRODUCT_LIMITS.maximumImageCalls);
  });

});

describe("sequence reference policy", () => {
  it("selects and truncates deterministically by frame-specific, canonical, then continuity output", () => {
    const references = [
      reference("style", 2, "style"),
      reference("specific", 3, "frame-specific", ["frame-2"]),
      reference("subject", 1, "subject"),
    ];
    const current = frame(
      "frame-2",
      2,
      ["style", "specific", "subject"],
      [{ frameId: "frame-1", kind: "continuity" }],
    );
    const outputs = [output()];

    expect(selectSequenceReferences({ frame: current, references, outputs, maximumReferences: 4 })).toEqual([
      { kind: "reference", id: "specific", tier: "frame-specific" },
      { kind: "reference", id: "subject", tier: "canonical" },
      { kind: "reference", id: "style", tier: "canonical" },
      { kind: "prior-output", id: "output-1", tier: "prior-accepted-frame" },
    ]);
    expect(selectSequenceReferences({ frame: current, references: [...references].reverse(), outputs, maximumReferences: 2 }))
      .toEqual([
        { kind: "reference", id: "specific", tier: "frame-specific" },
        { kind: "reference", id: "subject", tier: "canonical" },
      ]);
  });

  it("marks direct reference users and only their explicit dependency closure as affected", () => {
    const frames = [
      frame("frame-1", 1, ["reference-a"]),
      frame("frame-2", 2, [], [{ frameId: "frame-1", kind: "continuity" }]),
      frame("frame-3", 3, ["reference-b"]),
      frame("frame-4", 4, [], [{ frameId: "frame-3", kind: "content" }]),
    ];
    expect(calculateAffectedFrameIds({ changedReferenceId: "reference-a", frames })).toEqual(["frame-1", "frame-2"]);
  });
});

describe("sequence persistence state", () => {
  function record(): SequencePersistenceRecord {
    return {
      schemaVersion: 1,
      id: "sequence-1",
      userId: "user-1",
      version: 1,
      createdAt: "2026-09-12T09:00:00.000Z",
      updatedAt: "2026-09-12T09:00:00.000Z",
      planRevisions: [{
        id: "revision-1",
        revision: 1,
        createdAt: "2026-09-12T09:00:00.000Z",
        plannerModelAlias: "kavero-chat-orchestration-default",
        imageModelAlias: "kavero-image-generation-default",
        title: "Sequence",
        sequenceType: "storyboard",
        goal: "Tell a story",
        countRationale: "Two beats",
        sharedRules: { style: null, subject: null, character: null, product: null, palette: null, typography: null, composition: null },
        references: [],
        frames: [frame("frame-1", 1), frame("frame-2", 2)],
        warnings: [],
        assumptions: [],
        approvedAt: "2026-09-12T09:01:00.000Z",
      }],
      execution: {
        status: "running",
        activePlanRevisionId: "revision-1",
        nextFrameId: "frame-1",
        imageCallsUsed: 0,
        plannerCallsUsed: 1,
        cancelRequestedAt: null,
        lastUpdatedAt: "2026-09-12T09:01:00.000Z",
      },
      attempts: [],
      outputs: [],
    };
  }

  it("builds the exact execution prompt from the frozen frame and shared rules", () => {
    const persisted = record();
    const revision = persisted.planRevisions[0];
    expect(buildSequenceFramePrompt(revision, revision.frames[0])).toContain("Prompt frame-1");
    expect(buildSequenceFramePrompt(revision, revision.frames[0])).not.toContain("undefined");
  });

  it("represents partial success and retry lineage without mutating accepted output", () => {
    const initial = record();
    const firstAttempt: SequenceAttempt = {
      id: "attempt-1",
      frameId: "frame-1",
      planRevisionId: "revision-1",
      attemptNumber: 1,
      status: "succeeded",
      startedAt: "2026-09-12T10:00:00.000Z",
      finishedAt: "2026-09-12T10:00:30.000Z",
      outputId: "output-1",
      replacesOutputId: null,
      errorCode: null,
      retryable: false,
    };
    const withAccepted = acceptSequenceOutput({
      record: appendSequenceOutput(appendSequenceAttempt(initial, firstAttempt), output()),
      frameId: "frame-1",
      outputId: "output-1",
      acceptedAt: "2026-09-12T10:01:00.000Z",
    });
    const failedRetry: SequenceAttempt = {
      ...firstAttempt,
      id: "attempt-2",
      frameId: "frame-2",
      attemptNumber: 2,
      status: "failed",
      outputId: null,
      replacesOutputId: null,
      errorCode: "provider_error",
      retryable: true,
    };
    const partial = appendSequenceAttempt(withAccepted, failedRetry);

    expect(initial.outputs).toEqual([]);
    expect(partial.outputs).toEqual([expect.objectContaining({ id: "output-1", acceptedAt: "2026-09-12T10:01:00.000Z" })]);
    expect(partial.attempts).toHaveLength(2);
    expect(partial.planRevisions[0].frames[0]).toMatchObject({ status: "accepted", acceptedOutputId: "output-1" });
    expect(partial.planRevisions[0].frames[1]).toMatchObject({ status: "pending", acceptedOutputId: null });
    expect(partial.version).toBe(5);
  });

  it("bounds execution, preserves partial success, and resumes without repeating accepted frames", () => {
    const started = beginSequenceExecution(record(), "2026-09-12T10:00:00.000Z");
    const first = beginSequenceAttempt({
      record: started,
      frameId: "frame-1",
      attemptId: "attempt-1",
      startedAt: "2026-09-12T10:00:01.000Z",
    });
    expect(first).toMatchObject({ ok: true, attempt: { attemptNumber: 1 } });
    if (!first.ok) throw new Error("Expected first attempt to start");

    const accepted = succeedSequenceAttempt({
      record: first.record,
      attemptId: first.attempt.id,
      output: output({ acceptedAt: null }),
      finishedAt: "2026-09-12T10:00:30.000Z",
    });
    expect(accepted.execution).toMatchObject({ status: "running", nextFrameId: "frame-2", imageCallsUsed: 1 });

    const repeat = beginSequenceAttempt({
      record: accepted,
      frameId: "frame-1",
      attemptId: "attempt-repeat",
      startedAt: "2026-09-12T10:00:31.000Z",
    });
    expect(repeat).toEqual({ ok: false, reason: "frame-already-complete" });

    const second = beginSequenceAttempt({
      record: accepted,
      frameId: "frame-2",
      attemptId: "attempt-2",
      startedAt: "2026-09-12T10:00:32.000Z",
    });
    if (!second.ok) throw new Error("Expected second attempt to start");
    const partial = failSequenceAttempt({
      record: second.record,
      attemptId: second.attempt.id,
      finishedAt: "2026-09-12T10:00:40.000Z",
      errorCode: "provider_error",
      retryable: true,
    });
    expect(partial.execution.status).toBe("partially-complete");

    const resumed = resumeSequenceExecution(partial, "2026-09-12T10:01:00.000Z");
    expect(resumed.execution).toMatchObject({ status: "running", nextFrameId: "frame-2" });
    expect(resumed.planRevisions[0].frames[0]).toMatchObject({ status: "accepted", acceptedOutputId: "output-1" });
    expect(resumed.planRevisions[0].frames[1].status).toBe("pending");
  });

  it("stops new calls after cancellation and enforces dependency, retry, call, and concurrency bounds", () => {
    const initial = record();
    const base = {
      ...initial,
      planRevisions: [{
        ...initial.planRevisions[0],
        frames: [
          initial.planRevisions[0].frames[0],
          { ...initial.planRevisions[0].frames[1], dependencies: [{ frameId: "frame-1", kind: "continuity" as const }] },
        ],
      }],
    };
    const running = beginSequenceExecution(base, "2026-09-12T10:00:00.000Z");
    expect(beginSequenceAttempt({
      record: running,
      frameId: "frame-2",
      attemptId: "attempt-blocked",
      startedAt: "2026-09-12T10:00:01.000Z",
    })).toEqual({ ok: false, reason: "dependencies-incomplete" });

    const cancelled = requestSequenceCancellation(running, "2026-09-12T10:00:02.000Z");
    expect(cancelled.execution.status).toBe("cancelled");
    expect(beginSequenceAttempt({
      record: cancelled,
      frameId: "frame-1",
      attemptId: "attempt-after-cancel",
      startedAt: "2026-09-12T10:00:03.000Z",
    })).toEqual({ ok: false, reason: "record-not-running" });

    const callLimited = {
      ...running,
      execution: { ...running.execution, imageCallsUsed: SEQUENCE_PRODUCT_LIMITS.maximumImageCalls },
    };
    expect(beginSequenceAttempt({
      record: callLimited,
      frameId: "frame-1",
      attemptId: "attempt-over-budget",
      startedAt: "2026-09-12T10:00:04.000Z",
    })).toEqual({ ok: false, reason: "image-call-limit" });
  });

  it("lets an in-flight frame finish after cancellation but never advances to another call", () => {
    const started = beginSequenceExecution(record(), "2026-09-12T10:00:00.000Z");
    const begun = beginSequenceAttempt({
      record: started,
      frameId: "frame-1",
      attemptId: "attempt-1",
      startedAt: "2026-09-12T10:00:01.000Z",
    });
    if (!begun.ok) throw new Error("Expected attempt to start");
    const cancelling = requestSequenceCancellation(begun.record, "2026-09-12T10:00:02.000Z");
    const stopped = succeedSequenceAttempt({
      record: cancelling,
      attemptId: "attempt-1",
      output: output({ acceptedAt: null }),
      finishedAt: "2026-09-12T10:00:30.000Z",
    });
    expect(stopped.execution).toMatchObject({ status: "cancelled", nextFrameId: "frame-2" });
    expect(beginSequenceAttempt({
      record: stopped,
      frameId: "frame-2",
      attemptId: "attempt-2",
      startedAt: "2026-09-12T10:00:31.000Z",
    })).toEqual({ ok: false, reason: "record-not-running" });
  });
});
