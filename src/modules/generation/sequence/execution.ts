import type { SequenceFrame, SequencePlanRevision } from "./contracts";

export function buildSequenceFramePrompt(plan: SequencePlanRevision, frame: SequenceFrame) {
  const rules = Object.entries(plan.sharedRules)
    .filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()))
    .map(([key, value]) => `${key}: ${value.trim()}`);
  return [frame.prompt, rules.length > 0 ? `Keep these approved sequence rules:\n${rules.join("\n")}` : ""]
    .filter(Boolean)
    .join("\n\n");
}
