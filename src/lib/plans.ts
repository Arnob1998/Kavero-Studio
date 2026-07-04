export type UserPlan = "free" | "premium";

export const freePlanGenerationLimit = 20;

export function normalizeUserPlan(value: unknown): UserPlan {
  return value === "premium" ? "premium" : "free";
}

export function getGenerationLimit(plan: UserPlan) {
  return plan === "premium" ? null : freePlanGenerationLimit;
}
