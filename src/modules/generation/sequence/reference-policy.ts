import type {
  SequenceFrame,
  SequenceFrameId,
  SequenceOutputLineage,
  SequenceReference,
  SequenceReferenceId,
} from "./contracts";

const CANONICAL_ROLE_PRIORITY = [
  "subject",
  "character",
  "product",
  "brand",
  "style",
  "palette",
  "typography",
  "composition",
] as const;

export type SelectedSequenceReference = Readonly<{
  kind: "reference" | "prior-output";
  id: SequenceReferenceId | string;
  tier: "frame-specific" | "canonical" | "prior-accepted-frame";
}>;

export function selectSequenceReferences(input: {
  frame: SequenceFrame;
  frames?: readonly SequenceFrame[];
  references: readonly SequenceReference[];
  outputs: readonly SequenceOutputLineage[];
  maximumReferences: number;
}): SelectedSequenceReference[] {
  if (!Number.isInteger(input.maximumReferences) || input.maximumReferences <= 0) return [];

  const assigned = new Set(input.frame.referenceIds);
  const ordered = [...input.references].sort(compareReference);
  const frameSpecific = ordered.filter((reference) =>
    assigned.has(reference.id) && (reference.role === "frame-specific" || reference.frameIds.includes(input.frame.id)),
  );
  const canonical = ordered.filter((reference) =>
    assigned.has(reference.id) && !frameSpecific.some((specific) => specific.id === reference.id),
  );
  const selected: SelectedSequenceReference[] = [
    ...frameSpecific.map((reference) => ({ kind: "reference" as const, id: reference.id, tier: "frame-specific" as const })),
    ...canonical.map((reference) => ({ kind: "reference" as const, id: reference.id, tier: "canonical" as const })),
  ];

  const continuityDependencies = input.frame.dependencies.filter((dependency) => dependency.kind === "continuity");
  for (const dependency of continuityDependencies) {
    const acceptedOutputId = input.frames?.find((frame) => frame.id === dependency.frameId)?.acceptedOutputId;
    const accepted = acceptedOutputId
      ? input.outputs.find((output) => output.id === acceptedOutputId && output.frameId === dependency.frameId && output.acceptedAt !== null)
      : input.frames ? null : [...input.outputs]
        .filter((output) => output.frameId === dependency.frameId && output.acceptedAt !== null)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id))[0];
    if (accepted) selected.push({ kind: "prior-output", id: accepted.id, tier: "prior-accepted-frame" });
  }

  return selected.slice(0, input.maximumReferences);
}

export function calculateAffectedFrameIds(input: {
  changedReferenceId: SequenceReferenceId;
  frames: readonly SequenceFrame[];
}): SequenceFrameId[] {
  const affected = new Set(
    input.frames.filter((frame) => frame.referenceIds.includes(input.changedReferenceId)).map((frame) => frame.id),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const frame of input.frames) {
      if (!affected.has(frame.id) && frame.dependencies.some((dependency) => affected.has(dependency.frameId))) {
        affected.add(frame.id);
        changed = true;
      }
    }
  }
  return input.frames
    .filter((frame) => affected.has(frame.id))
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    .map((frame) => frame.id);
}

function compareReference(left: SequenceReference, right: SequenceReference) {
  const leftRole = left.role === "frame-specific" ? -1 : CANONICAL_ROLE_PRIORITY.indexOf(left.role);
  const rightRole = right.role === "frame-specific" ? -1 : CANONICAL_ROLE_PRIORITY.indexOf(right.role);
  return left.order - right.order || leftRole - rightRole || left.id.localeCompare(right.id);
}
