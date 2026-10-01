import { describe, expect, it, vi } from "vitest";
import { createSupabaseSequenceRepository } from "./repository";
import type { SequencePersistenceRecord } from "./contracts";

function record(version = 1): SequencePersistenceRecord {
  return {
    schemaVersion: 1,
    id: "sequence-1",
    userId: "user-1",
    version,
    createdAt: "2026-09-27T10:00:00.000Z",
    updatedAt: "2026-09-27T10:00:00.000Z",
    planRevisions: [],
    execution: {
      status: "draft",
      activePlanRevisionId: "revision-1",
      nextFrameId: null,
      imageCallsUsed: 0,
      plannerCallsUsed: 1,
      cancelRequestedAt: null,
      lastUpdatedAt: "2026-09-27T10:00:00.000Z",
    },
    attempts: [],
    outputs: [],
  };
}

function builder(result: { data: unknown; error: unknown }) {
  const value = {
    eq: vi.fn(() => value),
    select: vi.fn(() => value),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result),
  };
  return value;
}

describe("Supabase sequence repository", () => {
  it("loads owner-scoped records and mirrors the authoritative row version", async () => {
    const chain = builder({ data: { version: 4, record: record(3) }, error: null });
    const repository = createSupabaseSequenceRepository({ from: vi.fn(() => ({
      select: vi.fn(() => chain), insert: vi.fn(() => chain), update: vi.fn(() => chain),
    })) } as never);
    await expect(repository.load("sequence-1", "user-1")).resolves.toMatchObject({ version: 4 });
    expect(chain.eq).toHaveBeenNthCalledWith(1, "id", "sequence-1");
    expect(chain.eq).toHaveBeenNthCalledWith(2, "user_id", "user-1");
  });

  it("creates version one and rejects non-monotonic saves before database traffic", async () => {
    const chain = builder({ data: { version: 1, record: record(1) }, error: null });
    const from = vi.fn(() => ({ select: vi.fn(() => chain), insert: vi.fn(() => chain), update: vi.fn(() => chain) }));
    const repository = createSupabaseSequenceRepository({ from } as never);
    await expect(repository.save(record(1), 0)).resolves.toMatchObject({ status: "saved", record: { version: 1 } });
    await expect(repository.save(record(3), 1)).resolves.toEqual({ status: "conflict", currentVersion: 1 });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("uses compare-and-swap version filters for updates", async () => {
    const chain = builder({ data: { version: 2, record: record(2) }, error: null });
    const repository = createSupabaseSequenceRepository({ from: vi.fn(() => ({
      select: vi.fn(() => chain), insert: vi.fn(() => chain), update: vi.fn(() => chain),
    })) } as never);
    await expect(repository.save(record(2), 1)).resolves.toMatchObject({ status: "saved", record: { version: 2 } });
    expect(chain.eq).toHaveBeenCalledWith("version", 1);
  });
});
