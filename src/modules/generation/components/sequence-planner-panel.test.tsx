import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SequencePlannerPanel, SequenceToggle } from "./sequence-planner-panel";
import type { SequencePersistenceRecord, SequencePlanDraft, SequencePlannerReferenceInput } from "../sequence";

const references: SequencePlannerReferenceInput[] = [{
  id: "ref-1",
  label: "Hero product",
  role: "product",
  dataUrl: "data:image/png;base64,QQ==",
  mimeType: "image/png",
  byteSize: 1,
}];

const plan: SequencePlanDraft = {
  title: "Launch",
  sequenceType: "carousel",
  countRationale: "Two frames introduce and resolve the idea.",
  sharedRules: { style: "Editorial", subject: null, character: null, product: "Same product", palette: null, typography: null, composition: null },
  frames: [
    { id: "frame-1", purpose: "Introduce", prompt: "Product on a clean table", referenceIds: ["ref-1"], dependencies: [] },
    { id: "frame-2", purpose: "Resolve", prompt: "Product in use", referenceIds: [], dependencies: ["frame-1"] },
  ],
  warnings: ["Consistency is assisted."],
  assumptions: ["The same product appears in both frames."],
};

function executionRecord(): SequencePersistenceRecord {
  return {
    schemaVersion: 1,
    id: "11111111-1111-4111-8111-111111111111",
    userId: "user-1",
    version: 4,
    createdAt: "2026-09-27T10:00:00.000Z",
    updatedAt: "2026-09-27T10:01:00.000Z",
    planRevisions: [{
      id: "22222222-2222-4222-8222-222222222222",
      revision: 2,
      createdAt: "2026-09-27T10:00:00.000Z",
      plannerModelAlias: "kavero-chat-orchestration-default",
      imageModelAlias: "kavero-image-generation-default",
      title: plan.title,
      sequenceType: plan.sequenceType,
      goal: "Launch",
      countRationale: plan.countRationale,
      sharedRules: plan.sharedRules,
      references: [],
      frames: plan.frames.map((frame, index) => ({
        ...frame,
        position: index + 1,
        dependencies: frame.dependencies.map((frameId) => ({ frameId, kind: "continuity" as const })),
        status: index === 0 ? "accepted" as const : "pending" as const,
        attemptIds: index === 0 ? ["33333333-3333-4333-8333-333333333333"] : [],
        acceptedOutputId: index === 0 ? "44444444-4444-4444-8444-444444444444" : null,
      })),
      warnings: [],
      assumptions: [],
      approvedAt: "2026-09-27T10:00:01.000Z",
    }],
    execution: {
      status: "running",
      activePlanRevisionId: "22222222-2222-4222-8222-222222222222",
      nextFrameId: "frame-2",
      imageCallsUsed: 1,
      plannerCallsUsed: 1,
      cancelRequestedAt: null,
      lastUpdatedAt: "2026-09-27T10:01:00.000Z",
    },
    attempts: [],
    outputs: [],
  };
}

describe("Sequence planner review UI", () => {
  it("keeps Sequence an explicit off-by-default switch", () => {
    const onToggle = vi.fn();
    render(<SequenceToggle enabled={false} onToggle={onToggle} />);
    expect(screen.getByRole("switch", { name: "Sequence" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("switch", { name: "Sequence" }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("shows ordered reference controls and fails an ineligible planner closed", () => {
    const onMoveReference = vi.fn();
    const onChangeReferenceRole = vi.fn();
    const onRemoveReference = vi.fn();
    render(
      <SequencePlannerPanel
        state={{ status: "idle" }} references={references} plannerLabel="Unverified model" plannerEligible={false} callsUsed={0}
        onRequestPlan={vi.fn()} onChangePlan={vi.fn()} onApprove={vi.fn()}
        onMoveReference={onMoveReference} onChangeReferenceRole={onChangeReferenceRole} onRemoveReference={onRemoveReference}
      />,
    );
    expect(screen.getByText(/not verified for sequence planning/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create sequence plan" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Role for Hero product" }), { target: { value: "style" } });
    expect(onChangeReferenceRole).toHaveBeenCalledWith("ref-1", "style");
    fireEvent.click(screen.getByRole("button", { name: "Remove Hero product" }));
    expect(onRemoveReference).toHaveBeenCalledWith("ref-1");
  });

  it("lets the user edit frames and assignments before explicit approval", () => {
    const onChangePlan = vi.fn();
    const onApprove = vi.fn();
    render(
      <SequencePlannerPanel
        state={{ status: "review", plan, approved: false, revision: 1 }} references={references} plannerLabel="Gemini" plannerEligible callsUsed={1}
        onRequestPlan={vi.fn()} onChangePlan={onChangePlan} onApprove={onApprove}
        onMoveReference={vi.fn()} onChangeReferenceRole={vi.fn()} onRemoveReference={vi.fn()}
      />,
    );
    expect(screen.getByText("2 image calls after approval")).toBeInTheDocument();
    expect(screen.getByText("Consistency is assisted.")).toBeInTheDocument();
    expect(screen.getByText("The same product appears in both frames.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt for frame 1" }), { target: { value: "Updated prompt" } });
    expect(onChangePlan).toHaveBeenCalledWith(expect.objectContaining({
      frames: expect.arrayContaining([expect.objectContaining({ id: "frame-1", prompt: "Updated prompt" })]),
    }));
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("exposes explicit bounded execution only after approval", () => {
    const onExecute = vi.fn();
    render(
      <SequencePlannerPanel
        state={{ status: "review", plan, approved: true, revision: 2 }} references={references} plannerLabel="Gemini" plannerEligible callsUsed={1}
        onRequestPlan={vi.fn()} onChangePlan={vi.fn()} onApprove={vi.fn()}
        onMoveReference={vi.fn()} onChangeReferenceRole={vi.fn()} onRemoveReference={vi.fn()}
        onExecute={onExecute}
      />,
    );
    expect(screen.getByRole("button", { name: "Plan approved" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /generate sequence/i }));
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it("shows persisted progress and requests cancellation without discarding completed frames", () => {
    const onCancel = vi.fn();
    render(
      <SequencePlannerPanel
        state={{ status: "review", plan, approved: true, revision: 2 }} references={references} plannerLabel="Gemini" plannerEligible callsUsed={1}
        onRequestPlan={vi.fn()} onChangePlan={vi.fn()} onApprove={vi.fn()}
        onMoveReference={vi.fn()} onChangeReferenceRole={vi.fn()} onRemoveReference={vi.fn()}
        execution={{
          status: "running",
          record: executionRecord(),
          visuals: { "frame-1": { dataUrl: "data:image/png;base64,QQ==", mimeType: "image/png", generatedImageId: "image-1" } },
          message: "Generating frame 2…",
        }}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("1 / 2 frames saved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText("accepted")).toBeInTheDocument();
  });

  it("offers targeted regeneration and locks the frozen plan after completion", () => {
    const onRegenerate = vi.fn();
    const onReplaceReference = vi.fn();
    const record = executionRecord();
    const completed: SequencePersistenceRecord = {
      ...record,
      planRevisions: [{
        ...record.planRevisions[0],
        references: [{ id: "ref-1", order: 0, label: "Hero product", role: "product", frameIds: ["frame-1"], source: {
          kind: "upload", assetId: "ref-1", mimeType: "image/png", byteSize: 1,
          sourceSequenceId: null, sourceFrameId: null, sourceOutputId: null,
        } }],
        frames: record.planRevisions[0].frames.map((frame) => ({ ...frame, status: "accepted", acceptedOutputId: frame.acceptedOutputId ?? "output-2" })),
      }],
      execution: { ...record.execution, status: "complete", nextFrameId: null },
    };
    render(<SequencePlannerPanel
      state={{ status: "review", plan, approved: true, revision: 2 }} references={references} plannerLabel="Gemini" plannerEligible callsUsed={1}
      onRequestPlan={vi.fn()} onChangePlan={vi.fn()} onApprove={vi.fn()}
      onMoveReference={vi.fn()} onChangeReferenceRole={vi.fn()} onRemoveReference={vi.fn()}
      execution={{ status: "complete", record: completed, visuals: {}, message: "Complete" }}
      onRegenerate={onRegenerate} onReplaceReference={onReplaceReference}
    />);
    expect(screen.getByRole("textbox", { name: "Prompt for frame 1" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "Regenerate from here" })[1]);
    expect(onRegenerate).toHaveBeenCalledWith({ mode: "from-frame", frameId: "frame-2" });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate affected by Hero product" }));
    expect(onRegenerate).toHaveBeenCalledWith({ mode: "affected-reference", referenceId: "ref-1" });
    const file = new File(["image"], "replacement.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Replace image"), { target: { files: [file] } });
    expect(onReplaceReference).toHaveBeenCalledWith("ref-1", file);
  });
});
