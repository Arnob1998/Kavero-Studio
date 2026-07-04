import { z } from "zod";
import {
  aspectRatios,
  imageModelIds,
  modelLabels,
  referenceImageLimits,
} from "./generate-models";

export const referenceImageSchema = z.object({
  dataUrl: z.string().min(1),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]),
  name: z.string().optional(),
});

export const generateRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(12000),
    model: z.enum(imageModelIds).default("gemini-3.1-flash-image-preview"),
    count: z.coerce.number().int().min(1).max(16).default(1),
    thinking: z.enum(["fast", "balanced", "deep"]).default("balanced"),
    aspectRatio: z.enum(aspectRatios).default("auto"),
    imageSize: z.enum(["1K", "2K", "4K"]).default("1K"),
    schema: z.enum(["none", "magier-ai"]).default("none"),
    referenceImage: referenceImageSchema.nullish(),
    referenceImages: z.array(referenceImageSchema).nullish(),
  })
  .superRefine((input, context) => {
    const referenceImages = input.referenceImages ?? (input.referenceImage ? [input.referenceImage] : []);
    const limit = referenceImageLimits[input.model];

    if (referenceImages.length > limit) {
      context.addIssue({
        code: z.ZodIssueCode.too_big,
        type: "array",
        maximum: limit,
        inclusive: true,
        path: ["referenceImages"],
        message: `${modelLabels[input.model]} supports up to ${limit} reference images.`,
      });
    }
  });

export type GenerateRequestInput = z.infer<typeof generateRequestSchema>;
