import { describe, expect, it } from "vitest";
import { buildUpdatedEnvEntries, parseEnvContent } from "./env-file.mjs";

describe("env file helpers", () => {
  it("parses env entries while preserving comments and unknown lines", () => {
    const parsed = parseEnvContent("# hello\nA=1\nnot env\nB=two\n");
    expect(parsed.values).toEqual({ A: "1", B: "two" });
    expect(parsed.entries.map((entry) => entry.type)).toEqual(["raw", "entry", "raw", "entry"]);
  });

  it("preserves existing non-empty values by default", async () => {
    const result = await buildUpdatedEnvEntries({
      existingContent: "A=1\n",
      values: { A: "2", B: "3" },
    });

    expect(result.content).toBe("A=1\nB=3\n");
    expect(result.preserved).toEqual(["A"]);
    expect(result.added).toEqual(["B"]);
  });

  it("requires confirmation before overwriting secrets", async () => {
    const denied = await buildUpdatedEnvEntries({
      existingContent: "SUPABASE_SERVICE_ROLE_KEY=old\n",
      values: { SUPABASE_SERVICE_ROLE_KEY: "new" },
      confirmOverwrite: async () => false,
    });
    expect(denied.content).toBe("SUPABASE_SERVICE_ROLE_KEY=old\n");

    const accepted = await buildUpdatedEnvEntries({
      existingContent: "SUPABASE_SERVICE_ROLE_KEY=old\n",
      values: { SUPABASE_SERVICE_ROLE_KEY: "new" },
      confirmOverwrite: async () => true,
    });
    expect(accepted.content).toBe("SUPABASE_SERVICE_ROLE_KEY=new\n");
  });

  it("updates placeholder values without confirmation", async () => {
    const result = await buildUpdatedEnvEntries({
      existingContent: "SUPABASE_SERVICE_ROLE_KEY=replace-with-local-service-role-key\n",
      values: { SUPABASE_SERVICE_ROLE_KEY: "real" },
      confirmOverwrite: async () => false,
    });

    expect(result.content).toBe("SUPABASE_SERVICE_ROLE_KEY=real\n");
  });
});
