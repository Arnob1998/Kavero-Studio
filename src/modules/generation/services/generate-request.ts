import { z } from "zod";
import {
  type GenerateAspectRatio,
  type GenerateImageModelId,
  type GenerateImageSize,
  type GenerateThinking,
} from "./generate-models";
import { DEFAULT_IMAGE_MODEL_LEGACY_ID, validateLegacyImageRequest } from "@/modules/model-providers/image-capabilities";

export const referenceImageSchema = z.object({
  dataUrl: z.string().min(1),
  mimeType: z.string().min(1),
  name: z.string().optional(),
});

const generateRequestStructure = z
  .object({
    prompt: z.string().trim().min(1).max(12000),
    modelAlias: z.string().trim().min(1).max(200),
    model: z.string().default(DEFAULT_IMAGE_MODEL_LEGACY_ID),
    count: z.coerce.number().int().min(1).max(16).default(1),
    thinking: z.string().default("balanced"),
    aspectRatio: z.string().default("auto"),
    imageSize: z.string().default("1K"),
    quality: z.string().default("auto"),
    background: z.enum(["auto", "opaque", "transparent"]).default("auto"),
    schema: z.enum(["none", "magier-ai"]).default("none"),
    referenceImage: referenceImageSchema.nullish(),
    referenceImages: z.array(referenceImageSchema).nullish(),
    mask: z.unknown().optional(),
    sourceGenerationId: z.string().trim().min(1).max(200).optional(),
    sourceImageId: z.string().trim().min(1).max(200).optional(),
    clientRunId: z.string().trim().min(1).max(200).optional(),
    sequenceContext: z.object({
      sequenceId: z.string().uuid(),
      planRevisionId: z.string().uuid(),
      frameId: z.string().trim().min(1).max(80),
      framePosition: z.number().int().min(1).max(12),
      attemptId: z.string().uuid(),
      referenceIds: z.array(z.string().trim().min(1).max(80)).max(8),
      sourceOutputIds: z.array(z.string().uuid()).max(8),
    }).optional(),
  });

export type GenerateRequestInput = Omit<z.infer<typeof generateRequestStructure>, "model" | "thinking" | "aspectRatio" | "imageSize"> & {
  model: GenerateImageModelId;
  thinking: GenerateThinking;
  aspectRatio: GenerateAspectRatio;
  imageSize: GenerateImageSize;
};

export const generateRequestSchema = generateRequestStructure
  .superRefine((input, context) => {
    if (input.mask !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["mask"], message: "Mask-based image editing is not available." });
    }
    if (Boolean(input.sourceGenerationId) !== Boolean(input.sourceImageId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceGenerationId"], message: "Image edit lineage requires both source generation and image IDs." });
    }
    const referenceImages = input.referenceImages ?? (input.referenceImage ? [input.referenceImage] : []);
    if (input.sourceGenerationId && input.sourceImageId && referenceImages.length !== 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["referenceImages"], message: "Iterative editing requires exactly one source image." });
    }
    const issues = validateLegacyImageRequest({
      feature: "standalone-generate",
      model: input.model,
      count: input.count,
      thinking: input.thinking,
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      referenceImages,
    });
    for (const issue of issues) {
      const path = issue.field === "modelAlias" ? ["model"] : issue.field === "outputSize" ? ["imageSize"] : issue.field === "reasoning" ? ["thinking"] : issue.field === "referenceImages.mimeType" ? ["referenceImages"] : [issue.field];
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: issue.message,
      });
    }
  })
  .transform((input) => input as GenerateRequestInput);
