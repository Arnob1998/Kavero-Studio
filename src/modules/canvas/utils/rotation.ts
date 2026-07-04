export function normalizeRotationDegrees(value: number) {
  if (!Number.isFinite(value)) return 0;
  let normalized = value % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function roundSignedRotationDegrees(value: number | null | undefined) {
  return normalizeRotationDegrees(Math.round(value ?? 0));
}
