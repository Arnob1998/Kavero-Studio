"use client";

import { ArrowDown, ArrowUp, Check, Loader2, Play, Plus, RotateCcw, Square, Sparkles, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { SequencePersistenceRecord, SequencePlanDraft, SequencePlannerReferenceInput, SequenceReferenceRole } from "../sequence";
import { SEQUENCE_PRODUCT_LIMITS, sequenceReferenceRoles } from "../sequence";
import { DownloadImagesButton } from "./download-images-button";

export type SequencePlannerViewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "review"; plan: SequencePlanDraft; approved: boolean; revision: number };

export type SequenceExecutionVisual = {
  dataUrl: string;
  mimeType: string;
  generatedImageId: string;
};

export type SequenceExecutionViewState =
  | { status: "idle" }
  | { status: "saving"; message: string }
  | { status: "startup-error"; message: string }
  | {
      status: "running" | "partial" | "cancelled" | "complete" | "error";
      record: SequencePersistenceRecord;
      visuals: Record<string, SequenceExecutionVisual>;
      message: string;
      cancelRequested?: boolean;
    };

export function SequenceToggle({ enabled, onToggle }: { enabled: boolean; onToggle: (enabled: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      className={`mx-auto mt-6 inline-flex h-10 items-center gap-3 rounded-full border px-4 text-[12px] font-extrabold transition ${
        enabled ? "border-accent/55 bg-accent/18 text-white" : "border-white/[0.1] bg-white/[0.045] text-white/66 hover:bg-white/[0.08]"
      }`}
      onClick={() => onToggle(!enabled)}
    >
      <span className={`relative h-5 w-9 rounded-full transition ${enabled ? "bg-accent" : "bg-white/14"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
      </span>
      Sequence
    </button>
  );
}

export function SequencePlannerPanel({
  state,
  references,
  plannerLabel,
  plannerEligible,
  callsUsed,
  onRequestPlan,
  onChangePlan,
  onApprove,
  onMoveReference,
  onChangeReferenceRole,
  onRemoveReference,
  execution = { status: "idle" },
  onExecute,
  onCancel,
  onResume,
  onRegenerate,
  onReplaceReference,
  onKeepPrevious,
  onRecover,
}: {
  state: SequencePlannerViewState;
  references: readonly SequencePlannerReferenceInput[];
  plannerLabel: string;
  plannerEligible: boolean;
  callsUsed: number;
  onRequestPlan: () => void;
  onChangePlan: (plan: SequencePlanDraft) => void;
  onApprove: () => void;
  onMoveReference: (index: number, direction: -1 | 1) => void;
  onChangeReferenceRole: (id: string, role: SequenceReferenceRole) => void;
  onRemoveReference: (id: string) => void;
  execution?: SequenceExecutionViewState;
  onExecute?: () => void;
  onCancel?: () => void;
  onResume?: () => void;
  onRegenerate?: (action: { mode: "from-frame"; frameId: string } | { mode: "affected-reference"; referenceId: string }) => void;
  onReplaceReference?: (referenceId: string, file: File) => void;
  onKeepPrevious?: () => void;
  onRecover?: () => void;
}) {
  const plan = state.status === "review" ? state.plan : null;
  const canPlan = plannerEligible && callsUsed < SEQUENCE_PRODUCT_LIMITS.maximumPlannerCalls && state.status !== "loading";
  const frozen = execution.status !== "idle" && execution.status !== "startup-error";

  return (
    <section
      aria-label="Sequence planner"
      className="mx-auto mt-5 max-h-[calc(100svh-320px)] w-[min(940px,calc(100vw-32px))] overflow-y-auto rounded-2xl border border-white/[0.1] bg-black/48 p-4 text-left shadow-[0_28px_100px_rgb(0_0_0_/_0.56)] backdrop-blur-2xl [scrollbar-color:rgb(255_255_255_/_0.24)_transparent] sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.08] pb-4">
        <div>
          <h2 className="text-[17px] font-extrabold text-white">Plan your sequence</h2>
          <p className="mt-1 max-w-[68ch] text-[12px] font-semibold leading-5 text-white/52">
            Review every frame before any image is generated. Consistency is assisted, not guaranteed.
          </p>
        </div>
        <div className="text-right text-[10px] font-bold uppercase tracking-[0.08em] text-white/38">
          <span className="block text-white/66">{plannerLabel}</span>
          {state.status === "review" ? <span className="block">Plan revision {state.revision}</span> : null}
          {callsUsed} / {SEQUENCE_PRODUCT_LIMITS.maximumPlannerCalls} planner calls
        </div>
      </div>

      {references.length > 0 ? (
        <div className="mt-4 grid gap-2" aria-label="Ordered sequence references">
          <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-white/42">Ordered references</span>
          {references.map((reference, index) => (
            <div key={reference.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.035] p-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.06] text-[11px] font-black text-white/55">{index + 1}</span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-extrabold text-white/78">{reference.label}</span>
                <select
                  aria-label={`Role for ${reference.label}`}
                  className="mt-1 h-7 max-w-full rounded-lg border border-white/[0.08] bg-black/45 px-2 text-[10px] font-bold text-white/62 outline-none"
                  value={reference.role}
                  disabled={frozen}
                  onChange={(event) => onChangeReferenceRole(reference.id, event.target.value as SequenceReferenceRole)}
                >
                  {sequenceReferenceRoles.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </span>
              <span className="flex gap-1">
                <SmallButton label={`Move ${reference.label} up`} disabled={frozen || index === 0} onClick={() => onMoveReference(index, -1)}><ArrowUp size={13} /></SmallButton>
                <SmallButton label={`Move ${reference.label} down`} disabled={frozen || index === references.length - 1} onClick={() => onMoveReference(index, 1)}><ArrowDown size={13} /></SmallButton>
                <SmallButton label={`Remove ${reference.label}`} disabled={frozen} onClick={() => onRemoveReference(reference.id)}><Trash2 size={13} /></SmallButton>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {!plannerEligible ? (
        <Notice tone="error">The selected chat model is not verified for sequence planning. Choose an eligible chat model in Settings.</Notice>
      ) : state.status === "loading" ? (
        <Notice><Loader2 className="animate-spin" size={14} /> Creating a structured plan for review…</Notice>
      ) : state.status === "error" ? (
        <Notice tone="error">{state.message}</Notice>
      ) : null}

      {plan ? (
        <PlanEditor
          plan={plan}
          references={references}
          approved={state.status === "review" && state.approved}
          onChange={onChangePlan}
          onApprove={onApprove}
          execution={execution}
          onExecute={onExecute}
          onCancel={onCancel}
          onResume={onResume}
          onRegenerate={onRegenerate}
          onReplaceReference={onReplaceReference}
          onKeepPrevious={onKeepPrevious}
          onRecover={onRecover}
        />
      ) : (
        <button
          type="button"
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-[12px] font-extrabold text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canPlan}
          onClick={onRequestPlan}
        >
          <Sparkles size={15} /> {state.status === "error" ? "Try planning again" : "Create sequence plan"}
        </button>
      )}
    </section>
  );
}

function PlanEditor({ plan, references, approved, onChange, onApprove, execution, onExecute, onCancel, onResume, onRegenerate, onReplaceReference, onKeepPrevious, onRecover }: {
  plan: SequencePlanDraft;
  references: readonly SequencePlannerReferenceInput[];
  approved: boolean;
  onChange: (plan: SequencePlanDraft) => void;
  onApprove: () => void;
  execution: SequenceExecutionViewState;
  onExecute?: () => void;
  onCancel?: () => void;
  onResume?: () => void;
  onRegenerate?: (action: { mode: "from-frame"; frameId: string } | { mode: "affected-reference"; referenceId: string }) => void;
  onReplaceReference?: (referenceId: string, file: File) => void;
  onKeepPrevious?: () => void;
  onRecover?: () => void;
}) {
  const patchFrame = (index: number, patch: Partial<SequencePlanDraft["frames"][number]>) => {
    const frames = [...plan.frames];
    frames[index] = { ...frames[index], ...patch };
    onChange({ ...plan, frames });
  };
  const moveFrame = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= plan.frames.length) return;
    const frames = [...plan.frames];
    [frames[index], frames[nextIndex]] = [frames[nextIndex], frames[index]];
    onChange({ ...plan, frames: repairDependencies(frames) });
  };
  const removeFrame = (index: number) => {
    if (plan.frames.length <= 2) return;
    const removedId = plan.frames[index].id;
    onChange({ ...plan, frames: plan.frames.filter((_, current) => current !== index).map((frame) => ({ ...frame, dependencies: frame.dependencies.filter((id) => id !== removedId) })) });
  };
  const addFrame = () => {
    if (plan.frames.length >= SEQUENCE_PRODUCT_LIMITS.maximumFrames) return;
    let suffix = plan.frames.length + 1;
    while (plan.frames.some((frame) => frame.id === `frame-${suffix}`)) suffix += 1;
    onChange({ ...plan, frames: [...plan.frames, { id: `frame-${suffix}`, purpose: "New sequence beat", prompt: "Describe this frame.", referenceIds: [], dependencies: [] }] });
  };

  return (
    <div className="mt-4 grid gap-4">
      <fieldset disabled={execution.status !== "idle" && execution.status !== "startup-error"} className="contents disabled:opacity-55">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sequence title" value={plan.title} onChange={(title) => onChange({ ...plan, title })} />
        <Field label="Type" value={plan.sequenceType} onChange={(sequenceType) => onChange({ ...plan, sequenceType })} />
      </div>
      <label className="grid gap-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white/42">
        Why this count
        <textarea className={textareaClass} value={plan.countRationale} onChange={(event) => onChange({ ...plan, countRationale: event.target.value })} />
      </label>

      <details className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
        <summary className="cursor-pointer text-[11px] font-extrabold text-white/68">Shared consistency rules</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(Object.keys(plan.sharedRules) as Array<keyof SequencePlanDraft["sharedRules"]>).map((key) => (
            <Field key={key} label={key} value={plan.sharedRules[key] ?? ""} onChange={(value) => onChange({ ...plan, sharedRules: { ...plan.sharedRules, [key]: value.trim() ? value : null } })} />
          ))}
        </div>
      </details>

      {(plan.warnings.length > 0 || plan.assumptions.length > 0) ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <PlanNotes label="Warnings" values={plan.warnings} />
          <PlanNotes label="Assumptions" values={plan.assumptions} />
        </div>
      ) : null}

      <div className="grid gap-3" aria-label="Sequence frames">
        {plan.frames.map((frame, index) => (
          <article key={frame.id} className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-black uppercase tracking-[0.1em] text-accent">Frame {index + 1}</span>
              <span className="flex gap-1">
                <SmallButton label={`Move frame ${index + 1} up`} disabled={index === 0} onClick={() => moveFrame(index, -1)}><ArrowUp size={13} /></SmallButton>
                <SmallButton label={`Move frame ${index + 1} down`} disabled={index === plan.frames.length - 1} onClick={() => moveFrame(index, 1)}><ArrowDown size={13} /></SmallButton>
                <SmallButton label={`Remove frame ${index + 1}`} disabled={plan.frames.length <= 2} onClick={() => removeFrame(index)}><Trash2 size={13} /></SmallButton>
              </span>
            </div>
            <div className="mt-3 grid gap-2">
              <Field label="Purpose" value={frame.purpose} onChange={(purpose) => patchFrame(index, { purpose })} />
              <label className="grid gap-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white/42">
                Prompt
                <textarea aria-label={`Prompt for frame ${index + 1}`} className={`${textareaClass} min-h-24`} value={frame.prompt} onChange={(event) => patchFrame(index, { prompt: event.target.value })} />
              </label>
              {references.length > 0 ? (
                <fieldset className="flex flex-wrap gap-2">
                  <legend className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white/42">References</legend>
                  {references.map((reference) => (
                    <label key={reference.id} className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-black/18 px-2 py-1.5 text-[10px] font-bold text-white/62">
                      <input type="checkbox" checked={frame.referenceIds.includes(reference.id)} onChange={(event) => patchFrame(index, { referenceIds: event.target.checked ? [...frame.referenceIds, reference.id] : frame.referenceIds.filter((id) => id !== reference.id) })} />
                      {reference.label}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {index > 0 ? (
                <fieldset className="flex flex-wrap gap-2">
                  <legend className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white/42">Depends on</legend>
                  {plan.frames.slice(0, index).map((prior, priorIndex) => (
                    <label key={prior.id} className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-black/18 px-2 py-1.5 text-[10px] font-bold text-white/62">
                      <input type="checkbox" checked={frame.dependencies.includes(prior.id)} onChange={(event) => patchFrame(index, { dependencies: event.target.checked ? [...frame.dependencies, prior.id] : frame.dependencies.filter((id) => id !== prior.id) })} />
                      Frame {priorIndex + 1}
                    </label>
                  ))}
                </fieldset>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-4">
        <button type="button" className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.04] px-3 text-[11px] font-extrabold text-white/68 disabled:opacity-35" disabled={plan.frames.length >= SEQUENCE_PRODUCT_LIMITS.maximumFrames} onClick={addFrame}>
          <Plus size={14} /> Add frame
        </button>
        <span className="flex items-center gap-3">
          <span className="text-[11px] font-bold text-white/48">{plan.frames.length} image calls after approval</span>
          <button type="button" className={`inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[12px] font-extrabold transition ${approved ? "bg-emerald-500/18 text-emerald-100" : "bg-accent text-white hover:bg-accent-hover"}`} onClick={onApprove} disabled={approved || !isPlanReviewable(plan)}>
            <Check size={15} /> {approved ? "Plan approved" : "Approve plan"}
          </button>
        </span>
      </div>
      </fieldset>
      {approved ? (
        <ExecutionPanel
          plan={plan}
          execution={execution}
          onExecute={onExecute}
          onCancel={onCancel}
          onResume={onResume}
          onRegenerate={onRegenerate}
          onReplaceReference={onReplaceReference}
          onKeepPrevious={onKeepPrevious}
          onRecover={onRecover}
        />
      ) : null}
    </div>
  );
}

function ExecutionPanel({ plan, execution, onExecute, onCancel, onResume, onRegenerate, onReplaceReference, onKeepPrevious, onRecover }: {
  plan: SequencePlanDraft;
  execution: SequenceExecutionViewState;
  onExecute?: () => void;
  onCancel?: () => void;
  onResume?: () => void;
  onRegenerate?: (action: { mode: "from-frame"; frameId: string } | { mode: "affected-reference"; referenceId: string }) => void;
  onReplaceReference?: (referenceId: string, file: File) => void;
  onKeepPrevious?: () => void;
  onRecover?: () => void;
}) {
  if (execution.status === "idle" || execution.status === "startup-error") {
    return (
      <Notice tone={execution.status === "startup-error" ? "error" : "default"}>
        <button type="button" className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-3 text-[11px] font-extrabold text-white hover:bg-accent-hover" onClick={onExecute}>
          <Play size={14} /> {execution.status === "startup-error" ? "Try execution again" : "Generate sequence"}
        </button>
        {execution.status === "startup-error" ? execution.message : "Sequential execution saves every successful frame before continuing."}
      </Notice>
    );
  }
  if (execution.status === "saving") return <Notice><Loader2 className="animate-spin" size={14} /> {execution.message}</Notice>;

  const revision = execution.record.planRevisions.find((candidate) => candidate.id === execution.record.execution.activePlanRevisionId);
  const frames = revision?.frames ?? [];
  const completed = frames.filter((frame) => frame.status === "accepted").length;
  const failedFrame = frames.find((frame) => frame.status === "failed");
  const latestFailedAttempt = failedFrame
    ? execution.record.attempts.find((attempt) => attempt.id === failedFrame.attemptIds[failedFrame.attemptIds.length - 1])
    : null;
  const retryable = Boolean(
    failedFrame
    && latestFailedAttempt?.status === "failed"
    && latestFailedAttempt.retryable
    && failedFrame.attemptIds.length < SEQUENCE_PRODUCT_LIMITS.maximumRetryAttemptsPerFrame,
  );
  return (
    <section aria-label="Sequence execution" className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <span className="block text-[11px] font-extrabold text-white/78">{completed} / {plan.frames.length} frames saved</span>
          <span className="mt-0.5 block text-[10px] font-bold text-white/42">{execution.record.execution.imageCallsUsed} / {SEQUENCE_PRODUCT_LIMITS.maximumImageCalls} image calls</span>
        </span>
        {frames.some((frame) => frame.acceptedOutputId && execution.visuals[frame.id]) ? (
          <DownloadImagesButton label="Export frames" name="kavero-sequence" images={frames.flatMap((frame) => {
            const visual = execution.visuals[frame.id];
            return frame.acceptedOutputId && visual ? [{ ...visual, name: `frame-${frame.position}` }] : [];
          })} />
        ) : null}
        {execution.status === "running" ? (
          <button type="button" className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.1] px-3 text-[10px] font-extrabold text-white/68 disabled:opacity-40" disabled={execution.cancelRequested} onClick={onCancel}>
            <Square size={12} /> {execution.cancelRequested ? "Stopping after this frame" : "Cancel"}
          </button>
        ) : execution.status === "partial" || execution.status === "cancelled" ? (
          <button type="button" className="inline-flex h-8 items-center gap-2 rounded-lg bg-accent px-3 text-[10px] font-extrabold text-white disabled:opacity-40" disabled={execution.status === "partial" && !retryable} onClick={onResume}>
            <RotateCcw size={12} /> {execution.status === "partial" ? "Retry failed frame" : "Resume"}
          </button>
        ) : null}
        {(execution.status === "partial" || execution.status === "cancelled") && frames.every((frame) => Boolean(frame.acceptedOutputId)) ? (
          <button type="button" className="inline-flex h-8 items-center rounded-lg border border-white/[0.1] px-3 text-[10px] font-extrabold text-white/68" onClick={onKeepPrevious}>Keep previous images</button>
        ) : null}
        {execution.status === "error" && execution.record.execution.status === "running" ? (
          <button type="button" className="inline-flex h-8 items-center rounded-lg border border-white/[0.1] px-3 text-[10px] font-extrabold text-white/68" onClick={onRecover}>Recover interrupted run</button>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {frames.map((frame) => {
          const visual = execution.visuals[frame.id];
          return (
            <div key={frame.id} className="grid grid-cols-[52px_minmax(0,1fr)] gap-2 rounded-lg border border-white/[0.06] bg-black/20 p-2">
              {visual ? <img src={visual.dataUrl} alt="" className="h-13 w-13 rounded-md object-cover" /> : <span className="grid h-13 w-13 place-items-center rounded-md bg-white/[0.045] text-[10px] font-black text-white/30">{frame.position}</span>}
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-extrabold text-white/72">Frame {frame.position}: {frame.purpose}</span>
                <span className="mt-1 block text-[10px] font-bold capitalize text-white/40">{frame.status}</span>
                {execution.status === "complete" ? <button type="button" className="mt-1 text-[10px] font-bold text-accent hover:underline" onClick={() => onRegenerate?.({ mode: "from-frame", frameId: frame.id })}>Regenerate from here</button> : null}
              </span>
            </div>
          );
        })}
      </div>
      {execution.status === "complete" && (revision?.references.length ?? 0) > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Reference regeneration">
          {revision?.references.map((reference) => (
            <span key={reference.id} className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.1] px-2 py-1 text-[10px] font-bold text-white/64">
              <button type="button" className="hover:text-white" onClick={() => onRegenerate?.({ mode: "affected-reference", referenceId: reference.id })}>Regenerate affected by {reference.label}</button>
              <label className="cursor-pointer text-accent hover:underline">
                Replace image
                <input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onReplaceReference?.(reference.id, file);
                  event.target.value = "";
                }} />
              </label>
            </span>
          ))}
        </div>
      ) : null}
      <p className={`mt-3 text-[11px] font-bold ${execution.status === "error" || execution.status === "partial" ? "text-red-100/72" : "text-white/52"}`}>{execution.message}</p>
    </section>
  );
}

function repairDependencies(frames: SequencePlanDraft["frames"]) {
  const prior = new Set<string>();
  return frames.map((frame) => {
    const repaired = { ...frame, dependencies: frame.dependencies.filter((id) => prior.has(id)) };
    prior.add(frame.id);
    return repaired;
  });
}

function isPlanReviewable(plan: SequencePlanDraft) {
  return Boolean(plan.title.trim() && plan.sequenceType.trim() && plan.countRationale.trim() && plan.frames.length >= 2 && plan.frames.every((frame) => frame.purpose.trim() && frame.prompt.trim()));
}

const inputClass = "h-9 rounded-lg border border-white/[0.08] bg-black/26 px-3 text-[12px] font-semibold text-white outline-none focus:border-accent/55";
const textareaClass = "min-h-16 resize-y rounded-lg border border-white/[0.08] bg-black/26 p-3 text-[12px] font-semibold leading-5 text-white outline-none focus:border-accent/55";

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white/42">{label}<input className={inputClass} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function PlanNotes({ label, values }: { label: string; values: readonly string[] }) {
  if (values.length === 0) return null;
  return (
    <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <h3 className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-white/42">{label}</h3>
      <ul className="mt-2 grid gap-1 pl-4 text-[11px] font-semibold leading-5 text-white/58">
        {values.map((value, index) => <li key={`${label}-${index}`} className="list-disc">{value}</li>)}
      </ul>
    </section>
  );
}

function SmallButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="grid h-7 w-7 place-items-center rounded-lg text-white/48 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-20">{children}</button>;
}

function Notice({ tone = "default", children }: { tone?: "default" | "error"; children: ReactNode }) {
  return <div className={`mt-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-bold ${tone === "error" ? "border-red-400/18 bg-red-500/8 text-red-100/78" : "border-white/[0.07] bg-white/[0.03] text-white/58"}`}>{children}</div>;
}
