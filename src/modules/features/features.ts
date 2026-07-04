export const features = {
  canvas: true,
  canvasAssets: true,
  canvasGeneration: true,
  copilot: true,
  autoSegment: true,
  gallery: true,
  promptTemplates: true,
  googleDriveStorage: true,
  supabaseDatabase: true,
  localDrafts: true,
} as const;

export type FeatureKey = keyof typeof features;

export function isFeatureEnabled(feature: FeatureKey) {
  return features[feature];
}
