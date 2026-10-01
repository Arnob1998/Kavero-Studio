import type { BackgroundRemovalPreprocessing } from "./types";

const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

export function imageDataToNchw(imageData: ImageData, preprocessing: BackgroundRemovalPreprocessing) {
  const pixels = imageData.width * imageData.height;
  const tensor = new Float32Array(pixels * 3);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const sourceOffset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = imageData.data[sourceOffset + channel] / 255;
      tensor[channel * pixels + pixel] =
        preprocessing === "imagenet" ? (value - IMAGENET_MEAN[channel]) / IMAGENET_STD[channel] : value;
    }
  }
  return tensor;
}

export function normalizeForegroundMask(values: Float32Array) {
  const normalized = new Uint8ClampedArray(values.length);
  let hasLogits = false;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] < 0 || values[index] > 1) {
      hasLogits = true;
      break;
    }
  }
  for (let index = 0; index < values.length; index += 1) {
    const value = hasLogits ? 1 / (1 + Math.exp(-values[index])) : values[index];
    normalized[index] = Math.round(Math.min(1, Math.max(0, value)) * 255);
  }
  return normalized;
}

export function createMaskImageData(mask: Uint8ClampedArray, width: number, height: number) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    rgba[offset] = 255;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 255;
    rgba[offset + 3] = mask[index];
  }
  return new ImageData(rgba, width, height);
}
