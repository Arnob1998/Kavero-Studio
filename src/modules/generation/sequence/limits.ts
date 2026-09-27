export const SEQUENCE_PRODUCT_LIMITS = Object.freeze({
  maximumFrames: 12,
  maximumUploads: 12,
  maximumUploadBytes: 10 * 1024 * 1024,
  maximumTotalUploadBytes: 32 * 1024 * 1024,
  maximumPlannerCalls: 3,
  maximumImageCalls: 36,
  maximumRetryAttemptsPerFrame: 2,
  maximumConcurrentImageCalls: 2,
});
