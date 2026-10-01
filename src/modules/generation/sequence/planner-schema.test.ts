import { describe, expect, it } from "vitest";
import { sequencePlanDraftSchema, sequencePlanRequestSchema, shouldSuggestSequence, validateAndNormalizeSequencePlan } from "./planner-schema";

function validPlan() {
  return {
    title: "Launch story",
    sequenceType: "carousel",
    countRationale: "Three frames establish, explain, and conclude.",
    sharedRules: {
      style: "Editorial collage",
      subject: "One red bicycle",
      character: null,
      product: null,
      palette: "Red, cream, charcoal",
      typography: null,
      composition: "Consistent centered framing",
    },
    frames: [
      { id: "frame-1", purpose: "Establish", prompt: "A red bicycle at dawn", referenceIds: ["ref-1", "ref-1"], dependencies: [] },
      { id: "frame-2", purpose: "Develop", prompt: "The bicycle in motion", referenceIds: ["ref-1"], dependencies: ["frame-1"] },
    ],
    warnings: ["Consistency is assisted, not guaranteed."],
    assumptions: [],
  };
}

describe("sequence planner schemas", () => {
  it("bounds planner requests before provider traffic", () => {
    expect(sequencePlanRequestSchema.safeParse({
      goal: "",
      imageModelAlias: "image",
      plannerCallNumber: 4,
      references: [],
    }).success).toBe(false);
  });

  it("accepts a bounded schema plan and removes duplicate assignments", () => {
    expect(sequencePlanDraftSchema.safeParse(validPlan()).success).toBe(true);
    const result = validateAndNormalizeSequencePlan(validPlan(), new Set(["ref-1"]));
    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (result.success) expect(result.plan.frames[0].referenceIds).toEqual(["ref-1"]);
  });

  it("rejects unknown references, duplicate frame IDs, and forward dependencies", () => {
    expect(validateAndNormalizeSequencePlan({
      ...validPlan(),
      frames: [{ ...validPlan().frames[0], referenceIds: ["unknown"] }, validPlan().frames[1]],
    }, new Set(["ref-1"]))).toEqual({ success: false, reason: "unknown-reference" });

    expect(validateAndNormalizeSequencePlan({
      ...validPlan(),
      frames: [validPlan().frames[0], { ...validPlan().frames[1], id: "frame-1" }],
    }, new Set(["ref-1"]))).toEqual({ success: false, reason: "duplicate-frame-id" });

    expect(validateAndNormalizeSequencePlan({
      ...validPlan(),
      frames: [{ ...validPlan().frames[0], dependencies: ["frame-2"] }, validPlan().frames[1]],
    }, new Set(["ref-1"]))).toEqual({ success: false, reason: "invalid-dependency" });
  });

  it("suggests Sequence without enabling it for explicit multi-image language", () => {
    expect(shouldSuggestSequence("Make a six-slide carousel about privacy")).toBe(true);
    expect(shouldSuggestSequence("Draw one quiet cabin at dusk")).toBe(false);
  });
});
