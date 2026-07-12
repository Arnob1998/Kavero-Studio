import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(join(process.cwd(), "supabase", "schema.sql"), "utf8");

describe("provider key schema contract", () => {
  it("keeps the provider row uniqueness and generic decrypt RPC", () => {
    expect(schema).toContain("unique (user_id, provider_id)");
    expect(schema).toContain("create or replace function public.get_provider_key(");
    expect(schema).toContain("provider_key.provider_id = p_provider_id");
  });

  it.each(["google-gemini", "openai", "groq", "azure-openai", "openai-compatible"])(
    "explicitly allows %s in upsert_provider_key",
    (providerId) => {
      expect(schema).toContain(`'${providerId}'`);
    },
  );

  it("retains an explicit unsupported-provider rejection and JSON validation", () => {
    expect(schema).toContain("raise exception 'Provider is not available yet'");
    expect(schema).toContain("credentials_json := p_secret::jsonb");
    expect(schema).toContain("grant execute on function public.upsert_provider_key(uuid, text, text, text) to service_role");
  });
});
