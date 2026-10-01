import type { SaveSequenceResult, SequencePersistenceRecord, SequenceRepository } from "./contracts";

type SequenceRunsClient = {
  from(table: "sequence_runs"): {
    select(columns: string): SequenceSelectBuilder;
    insert(value: Record<string, unknown>): {
      select(columns: string): { single<T>(): Promise<{ data: T | null; error: unknown | null }> };
    };
    update(value: Record<string, unknown>): SequenceUpdateBuilder;
  };
};

type SequenceSelectBuilder = {
  eq(column: string, value: unknown): SequenceSelectBuilder;
  maybeSingle<T>(): Promise<{ data: T | null; error: unknown | null }>;
};

type SequenceUpdateBuilder = {
  eq(column: string, value: unknown): SequenceUpdateBuilder;
  select(columns: string): { maybeSingle<T>(): Promise<{ data: T | null; error: unknown | null }> };
};

type SequenceRunRow = { version: number; record: SequencePersistenceRecord };

export function createSupabaseSequenceRepository(client: SequenceRunsClient): SequenceRepository {
  return {
    async load(sequenceId, userId) {
      const { data, error } = await client.from("sequence_runs")
        .select("version, record")
        .eq("id", sequenceId)
        .eq("user_id", userId)
        .maybeSingle<SequenceRunRow>();
      if (error || !data) return null;
      return { ...data.record, version: data.version };
    },

    async save(record, expectedVersion): Promise<SaveSequenceResult> {
      if (record.version !== expectedVersion + 1) {
        return { status: "conflict", currentVersion: expectedVersion };
      }
      if (expectedVersion === 0) {
        const { data, error } = await client.from("sequence_runs").insert({
          id: record.id,
          user_id: record.userId,
          version: record.version,
          record,
          created_at: record.createdAt,
          updated_at: record.updatedAt,
        }).select("version, record").single<SequenceRunRow>();
        if (error || !data) return { status: "conflict", currentVersion: 0 };
        return { status: "saved", record: { ...data.record, version: data.version } };
      }

      const { data, error } = await client.from("sequence_runs").update({
        version: record.version,
        record,
        updated_at: record.updatedAt,
      })
        .eq("id", record.id)
        .eq("user_id", record.userId)
        .eq("version", expectedVersion)
        .select("version, record")
        .maybeSingle<SequenceRunRow>();
      if (!error && data) return { status: "saved", record: { ...data.record, version: data.version } };

      const current = await this.load(record.id, record.userId);
      return current
        ? { status: "conflict", currentVersion: current.version }
        : { status: "not-found" };
    },
  };
}
