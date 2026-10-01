import { getModelCatalogEntry } from "@/modules/model-providers/catalog";
import { getImageModelCapabilities } from "@/modules/model-providers/image-capabilities";
import type { SequencePlannerCapabilities } from "@/modules/model-providers/types";

export type SequenceCapabilityIssueCode =
  | "unknown-planner-model"
  | "planner-not-eligible"
  | "planner-schema-output-unavailable"
  | "planner-image-input-unavailable"
  | "planner-image-limit-unknown"
  | "too-many-planner-images"
  | "unsupported-planner-image-type"
  | "planner-image-too-large"
  | "planner-images-too-large"
  | "unknown-image-model"
  | "image-model-not-eligible"
  | "image-references-unavailable";

export type SequenceCapabilityIssue = {
  code: SequenceCapabilityIssueCode;
  message: string;
};

export type SequencePlannerImage = { mimeType: string; byteSize: number };

export function validateSequenceCapabilities(input: {
  plannerModelAlias: string;
  imageModelAlias: string;
  plannerImages?: readonly SequencePlannerImage[];
  executionUsesReferences?: boolean;
}): SequenceCapabilityIssue[] {
  const issues: SequenceCapabilityIssue[] = [];
  const planner = getModelCatalogEntry(input.plannerModelAlias);
  const plannerCapability = planner?.capabilities.sequencePlanner;

  if (!planner || !planner.capabilities.slots.includes("chatOrchestration")) {
    issues.push({ code: "unknown-planner-model", message: "Unknown sequence planner model." });
  } else if (!plannerCapability?.eligible || plannerCapability.eligibility !== "verified") {
    issues.push({ code: "planner-not-eligible", message: `${planner.displayLabel} is not verified for sequence planning.` });
  } else {
    if (!plannerCapability.supportsSchemaConstrainedOutput) {
      issues.push({ code: "planner-schema-output-unavailable", message: `${planner.displayLabel} cannot produce the required schema-constrained plan.` });
    }
    issues.push(...validatePlannerImages(planner.displayLabel, plannerCapability.imageInput, input.plannerImages ?? []));
  }

  const imageModel = getImageModelCapabilities(input.imageModelAlias);
  if (!imageModel) {
    issues.push({ code: "unknown-image-model", message: "Unknown sequence image model." });
  } else {
    if (!imageModel.selectable || !imageModel.supportsTextToImage || !imageModel.compatibility["standalone-generate"]) {
      issues.push({ code: "image-model-not-eligible", message: `${imageModel.displayLabel} is not eligible for sequence generation.` });
    }
    if (input.executionUsesReferences && (!imageModel.supportsReferenceEditing || imageModel.maximumReferenceImages < 1)) {
      issues.push({ code: "image-references-unavailable", message: `${imageModel.displayLabel} cannot execute a reference-assisted sequence.` });
    }
  }

  return issues;
}

function validatePlannerImages(
  label: string,
  capability: SequencePlannerCapabilities["imageInput"],
  images: readonly SequencePlannerImage[],
): SequenceCapabilityIssue[] {
  if (images.length === 0) return [];
  if (!capability.eligible) {
    return [{ code: "planner-image-input-unavailable", message: `${label} is not verified for planner image input.` }];
  }
  if (capability.maximumImages.source === "unknown") {
    return [{ code: "planner-image-limit-unknown", message: `${label} has no verified or application-capped planner image limit.` }];
  }

  const issues: SequenceCapabilityIssue[] = [];
  if (images.length > capability.maximumImages.value) {
    issues.push({ code: "too-many-planner-images", message: `${label} accepts at most ${capability.maximumImages.value} planner images.` });
  }
  if (images.some((image) => !capability.supportedMimeTypes.includes(image.mimeType))) {
    issues.push({ code: "unsupported-planner-image-type", message: `${label} does not support one or more planner image types.` });
  }
  if (capability.maximumBytesPerImage.source === "unknown" || capability.maximumTotalBytes.source === "unknown") {
    issues.push({ code: "planner-image-limit-unknown", message: `${label} has no bounded planner image request-size contract.` });
    return issues;
  }
  const maximumBytesPerImage = capability.maximumBytesPerImage.value;
  const maximumTotalBytes = capability.maximumTotalBytes.value;
  if (images.some((image) => image.byteSize < 0 || image.byteSize > maximumBytesPerImage)) {
    issues.push({ code: "planner-image-too-large", message: `A planner image exceeds ${label}'s application byte limit.` });
  }
  if (images.reduce((total, image) => total + Math.max(0, image.byteSize), 0) > maximumTotalBytes) {
    issues.push({ code: "planner-images-too-large", message: `Planner images exceed ${label}'s total application byte limit.` });
  }
  return issues;
}
