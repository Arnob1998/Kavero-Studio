import { createClient } from "@/lib/supabase/server";
import { getResolvedModelProviderPreferences } from "@/modules/model-providers";
import { getImageModelCapabilities } from "@/modules/model-providers/image-capabilities";
import {
  createSupabaseSequenceRepository,
  beginSequenceAttempt,
  beginSequenceExecution,
  buildSequenceFramePrompt,
  failSequenceAttempt,
  freezeSequenceRunSchema,
  requestSequenceCancellation,
  keepPreviousSequenceOutputs,
  resumeSequenceExecution,
  replaceSequenceReference,
  scheduleSequenceRegeneration,
  selectSequenceReferences,
  SEQUENCE_PRODUCT_LIMITS,
  sequenceRunActionSchema,
  succeedSequenceAttempt,
  validateSequenceCapabilities,
  type SequencePersistenceRecord,
} from "@/modules/generation/sequence";

export const runtime = "nodejs";

function jsonError(message: string, status: number, details?: unknown) {
  return Response.json({ error: message, details }, { status });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return jsonError("Sign in to approve a sequence.", 401);

  const body = await request.json().catch(() => null);
  const parsed = freezeSequenceRunSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid approved sequence.", 400, parsed.error.flatten());
  const input = parsed.data;

  const { data: metadata, error: metadataError } = await supabase
    .from("user_metadata")
    .select("preferences")
    .eq("user_id", user.id)
    .maybeSingle<{ preferences: unknown }>();
  if (metadataError) return jsonError("Unable to verify selected models.", 500);
  const selected = getResolvedModelProviderPreferences(metadata?.preferences ?? {});
  if (
    selected.chatOrchestrationModelAlias !== input.plannerModelAlias
    || selected.imageGenerationModelAlias !== input.imageModelAlias
  ) {
    return jsonError("Your selected models changed. Review the plan and approve it again.", 409, {
      code: "model-selection-stale",
    });
  }

  const capabilityIssues = validateSequenceCapabilities({
    plannerModelAlias: input.plannerModelAlias,
    imageModelAlias: input.imageModelAlias,
    plannerImages: input.references.map(({ mimeType, byteSize }) => ({ mimeType, byteSize })),
    executionUsesReferences: input.references.length > 0,
  });
  if (capabilityIssues.length > 0) {
    return jsonError("The approved sequence is no longer executable with the selected models.", 400, capabilityIssues);
  }

  const now = new Date().toISOString();
  const sequenceId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const record: SequencePersistenceRecord = {
    schemaVersion: 1,
    id: sequenceId,
    userId: user.id,
    version: 1,
    createdAt: now,
    updatedAt: now,
    planRevisions: [{
      id: revisionId,
      revision: input.revision,
      createdAt: now,
      plannerModelAlias: input.plannerModelAlias,
      imageModelAlias: input.imageModelAlias,
      title: input.plan.title,
      sequenceType: input.plan.sequenceType,
      goal: input.goal,
      countRationale: input.plan.countRationale,
      sharedRules: input.plan.sharedRules,
      references: input.references.map((reference, order) => ({
        id: reference.id,
        order,
        label: reference.label,
        role: reference.role,
        frameIds: input.plan.frames.filter((frame) => frame.referenceIds.includes(reference.id)).map((frame) => frame.id),
        source: {
          kind: "upload",
          assetId: reference.id,
          mimeType: reference.mimeType,
          byteSize: reference.byteSize,
          sourceSequenceId: null,
          sourceFrameId: null,
          sourceOutputId: null,
        },
      })),
      frames: input.plan.frames.map((frame, position) => ({
        id: frame.id,
        position: position + 1,
        purpose: frame.purpose,
        prompt: frame.prompt,
        referenceIds: frame.referenceIds,
        dependencies: frame.dependencies.map((frameId) => ({ frameId, kind: "continuity" as const })),
        status: "pending" as const,
        attemptIds: [],
        acceptedOutputId: null,
      })),
      warnings: input.plan.warnings,
      assumptions: input.plan.assumptions,
      approvedAt: now,
    }],
    execution: {
      status: "awaiting-approval",
      activePlanRevisionId: revisionId,
      nextFrameId: input.plan.frames[0]?.id ?? null,
      imageCallsUsed: 0,
      plannerCallsUsed: input.plannerCallsUsed,
      cancelRequestedAt: null,
      lastUpdatedAt: now,
    },
    attempts: [],
    outputs: [],
  };

  const repository = createSupabaseSequenceRepository(supabase as never);
  const saved = await repository.save(record, 0);
  if (saved.status !== "saved") return jsonError("Unable to save the approved sequence.", 409);
  return Response.json({ sequence: saved.record }, { status: 201 });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return jsonError("Sign in to load a sequence.", 401);
  const sequenceId = new URL(request.url).searchParams.get("id")?.trim();
  if (!sequenceId) return jsonError("Sequence ID is required.", 400);
  const repository = createSupabaseSequenceRepository(supabase as never);
  const record = await repository.load(sequenceId, user.id);
  return record ? Response.json({ sequence: record }) : jsonError("Sequence not found.", 404);
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return jsonError("Sign in to update a sequence.", 401);
  const body = await request.json().catch(() => null);
  const parsed = sequenceRunActionSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid sequence update.", 400, parsed.error.flatten());
  const input = parsed.data;
  const repository = createSupabaseSequenceRepository(supabase as never);
  const current = await repository.load(input.sequenceId, user.id);
  if (!current) return jsonError("Sequence not found.", 404);
  if (current.version !== input.expectedVersion) {
    return jsonError("Sequence state changed. Reload before continuing.", 409, {
      code: "sequence-version-conflict",
      currentVersion: current.version,
    });
  }

  if (["start", "attempt-start", "resume", "regenerate", "replace-reference"].includes(input.action)) {
    const plan = current.planRevisions.find((revision) => revision.id === current.execution.activePlanRevisionId);
    if (!plan) return jsonError("The frozen sequence plan is unavailable.", 409);
    const { data: metadata, error: metadataError } = await supabase.from("user_metadata")
      .select("preferences").eq("user_id", user.id).maybeSingle<{ preferences: unknown }>();
    if (metadataError) return jsonError("Unable to verify selected models.", 500);
    const selected = getResolvedModelProviderPreferences(metadata?.preferences ?? {});
    if (selected.chatOrchestrationModelAlias !== plan.plannerModelAlias
      || selected.imageGenerationModelAlias !== plan.imageModelAlias) {
      return jsonError("Your selected models changed. Review the sequence before continuing.", 409, { code: "model-selection-stale" });
    }
    const issues = validateSequenceCapabilities({
      plannerModelAlias: plan.plannerModelAlias,
      imageModelAlias: plan.imageModelAlias,
      plannerImages: plan.references.map((reference) => ({ mimeType: reference.source.mimeType, byteSize: reference.source.byteSize })),
      executionUsesReferences: plan.references.length > 0,
    });
    if (issues.length > 0) return jsonError("The frozen models are no longer eligible for Sequence.", 409, issues);
  }

  const now = new Date().toISOString();
  let next = current;
  if (input.action === "start") {
    next = beginSequenceExecution(current, now);
  } else if (input.action === "attempt-start") {
    const result = beginSequenceAttempt({
      record: current,
      frameId: input.frameId,
      attemptId: input.attemptId,
      startedAt: now,
      replacesOutputId: input.replacesOutputId,
    });
    if (!result.ok) return jsonError("Sequence frame cannot start.", 409, { code: result.reason });
    next = result.record;
  } else if (input.action === "attempt-success") {
    const attempt = current.attempts.find((candidate) => candidate.id === input.attemptId && candidate.status === "running");
    if (!attempt) return jsonError("Sequence attempt is not running.", 409);
    const activePlan = current.planRevisions.find((revision) => revision.id === current.execution.activePlanRevisionId);
    if (!activePlan || activePlan.imageModelAlias !== input.modelAlias) {
      return jsonError("Generated output model does not match the frozen plan.", 409);
    }
    const frame = activePlan.frames.find((candidate) => candidate.id === attempt.frameId);
    if (!frame || buildSequenceFramePrompt(activePlan, frame) !== input.prompt) {
      return jsonError("Generated output prompt does not match the frozen frame.", 409);
    }
    const imageCapabilities = getImageModelCapabilities(activePlan.imageModelAlias);
    if (!imageCapabilities?.selectable) return jsonError("The frozen image model is unavailable.", 409);
    const selected = selectSequenceReferences({
      frame,
      frames: activePlan.frames,
      references: activePlan.references,
      outputs: current.outputs,
      maximumReferences: imageCapabilities.maximumReferenceImages,
    });
    const expectedReferenceIds = selected.filter((item) => item.kind === "reference").map((item) => item.id);
    const expectedSourceIds = selected.filter((item) => item.kind === "prior-output").map((item) => item.id);
    if (JSON.stringify(expectedReferenceIds) !== JSON.stringify(input.referenceIds)
      || JSON.stringify(expectedSourceIds) !== JSON.stringify(input.sourceOutputIds)) {
      return jsonError("Generated output references do not match the frozen plan.", 409);
    }
    const { data: generatedImage, error: imageError } = await supabase
      .from("generated_images")
      .select("id, generation_id")
      .eq("id", input.generatedImageId)
      .eq("user_id", user.id)
      .maybeSingle<{ id: string; generation_id: string }>();
    if (imageError || !generatedImage) return jsonError("Persisted generated image was not found.", 409);
    const { data: generation, error: generationError } = await supabase
      .from("generation_runs")
      .select("settings")
      .eq("id", generatedImage.generation_id)
      .eq("user_id", user.id)
      .maybeSingle<{ settings: { sequenceContext?: Record<string, unknown> } | null }>();
    const context = generation?.settings?.sequenceContext;
    if (generationError || !context || context.sequenceId !== current.id
      || context.planRevisionId !== activePlan.id || context.frameId !== frame.id
      || context.attemptId !== attempt.id || context.framePosition !== frame.position
      || JSON.stringify(context.referenceIds) !== JSON.stringify(input.referenceIds)
      || JSON.stringify(context.sourceOutputIds) !== JSON.stringify(input.sourceOutputIds)) {
      return jsonError("Persisted image does not belong to this sequence attempt.", 409);
    }
    next = succeedSequenceAttempt({
      record: current,
      attemptId: attempt.id,
      finishedAt: now,
      output: {
        id: crypto.randomUUID(),
        sequenceId: current.id,
        frameId: attempt.frameId,
        planRevisionId: attempt.planRevisionId,
        attemptId: attempt.id,
        generatedImageId: generatedImage.id,
        modelAlias: input.modelAlias,
        prompt: input.prompt,
        referenceIds: input.referenceIds,
        sourceOutputIds: input.sourceOutputIds,
        createdAt: now,
        acceptedAt: null,
        supersedesOutputId: attempt.replacesOutputId,
      },
    });
  } else if (input.action === "attempt-failure") {
    next = failSequenceAttempt({
      record: current,
      attemptId: input.attemptId,
      finishedAt: now,
      errorCode: input.errorCode,
      retryable: input.retryable,
    });
  } else if (input.action === "cancel") {
    next = requestSequenceCancellation(current, now);
  } else if (input.action === "resume") {
    next = resumeSequenceExecution(current, now);
  } else if (input.action === "keep-previous") {
    next = keepPreviousSequenceOutputs(current, now);
  } else if (input.action === "recover") {
    const attempt = current.attempts.find((candidate) => candidate.status === "running");
    if (current.execution.status !== "running" || !attempt?.startedAt) return jsonError("No interrupted attempt needs recovery.", 409);
    if (Date.now() - new Date(attempt.startedAt).getTime() < 180_000) {
      return jsonError("The frame may still be generating. Try recovery after three minutes.", 409, { code: "attempt-still-active" });
    }
    const plan = current.planRevisions.find((revision) => revision.id === attempt.planRevisionId);
    const frame = plan?.frames.find((candidate) => candidate.id === attempt.frameId);
    const capability = plan ? getImageModelCapabilities(plan.imageModelAlias) : null;
    if (!plan || !frame || !capability?.selectable) return jsonError("Frozen frame is unavailable for recovery.", 409);
    const selected = selectSequenceReferences({
      frame, frames: plan.frames, references: plan.references, outputs: current.outputs,
      maximumReferences: capability.maximumReferenceImages,
    });
    const referenceIds = selected.filter((item) => item.kind === "reference").map((item) => item.id);
    const sourceOutputIds = selected.filter((item) => item.kind === "prior-output").map((item) => item.id);
    const { data: savedRun, error: runError } = await supabase.from("generation_runs")
      .select("id, settings")
      .eq("user_id", user.id)
      .contains("settings", { sequenceContext: { sequenceId: current.id, attemptId: attempt.id } })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; settings: { sequenceContext?: Record<string, unknown> } }>();
    if (runError) return jsonError("Unable to check saved frame history.", 500);
    const context = savedRun?.settings?.sequenceContext;
    if (savedRun && (!context || context.frameId !== frame.id || context.planRevisionId !== plan.id
      || context.framePosition !== frame.position
      || JSON.stringify(context.referenceIds) !== JSON.stringify(referenceIds)
      || JSON.stringify(context.sourceOutputIds) !== JSON.stringify(sourceOutputIds))) {
      return jsonError("Saved frame history does not match the frozen attempt.", 409);
    }
    if (savedRun) {
      const { data: savedImage, error: imageError } = await supabase.from("generated_images")
        .select("id")
        .eq("generation_id", savedRun.id)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (imageError) return jsonError("Unable to check saved frame image.", 500);
      if (savedImage) {
        next = succeedSequenceAttempt({
          record: current, attemptId: attempt.id, finishedAt: now,
          output: {
            id: crypto.randomUUID(), sequenceId: current.id, frameId: frame.id, planRevisionId: plan.id,
            attemptId: attempt.id, generatedImageId: savedImage.id, modelAlias: plan.imageModelAlias,
            prompt: buildSequenceFramePrompt(plan, frame), referenceIds, sourceOutputIds,
            createdAt: now, acceptedAt: null, supersedesOutputId: attempt.replacesOutputId,
          },
        });
      }
    }
    if (next === current) {
      next = failSequenceAttempt({ record: current, attemptId: attempt.id, finishedAt: now, errorCode: "interrupted_attempt", retryable: true });
    }
  } else if (input.action === "regenerate") {
    next = scheduleSequenceRegeneration({ record: current, mode: input.mode, frameId: input.frameId, referenceId: input.referenceId, scheduledAt: now });
  } else if (input.action === "replace-reference") {
    const plan = current.planRevisions.find((revision) => revision.id === current.execution.activePlanRevisionId);
    const capability = plan ? getImageModelCapabilities(plan.imageModelAlias) : null;
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(input.dataUrl);
    if (!plan || !capability?.selectable || !capability.supportedReferenceMimeTypes.includes(input.mimeType)
      || !match || match[1].toLowerCase() !== input.mimeType
      || Buffer.from(match[2], "base64").byteLength !== input.byteSize) {
      return jsonError("Replacement reference is invalid for the frozen model.", 400);
    }
    const totalBytes = plan.references.reduce((total, reference) => total + (reference.id === input.referenceId ? input.byteSize : reference.source.byteSize), 0);
    if (totalBytes > SEQUENCE_PRODUCT_LIMITS.maximumTotalUploadBytes) return jsonError("Sequence references exceed the total byte limit.", 400);
    next = replaceSequenceReference({
      record: current, referenceId: input.referenceId, assetId: crypto.randomUUID(), revisionId: crypto.randomUUID(),
      label: input.label, mimeType: input.mimeType, byteSize: input.byteSize, replacedAt: now,
    });
  }

  if (next.version !== current.version + 1) {
    return jsonError("Sequence update is not valid for the current state.", 409);
  }
  const saved = await repository.save(next, current.version);
  if (saved.status === "saved") return Response.json({ sequence: saved.record });
  if (saved.status === "conflict") {
    return jsonError("Sequence state changed. Reload before continuing.", 409, {
      code: "sequence-version-conflict",
      currentVersion: saved.currentVersion,
    });
  }
  return jsonError("Sequence not found.", 404);
}
