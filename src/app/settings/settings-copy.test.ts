import { describe, expect, it } from "vitest";
import { getSettingsCopy } from "./settings-copy";

describe("settings copy", () => {
  it("uses connected Cloud storage copy without subscription language by default", () => {
    const copy = getSettingsCopy();

    expect(copy.deploymentProfile).toBe("cloud");
    expect(copy.overviewDescription).toContain("connected storage");
    expect(copy.storageStat).toEqual({
      value: "Drive",
      helper: "Connected storage",
    });
    expect(copy.storageQuickActionLabel).toBe("Connect storage");
    expect(copy.storagePageDescription).toContain("Google Drive");
    expect(copy.storagePanel.summaryTitle).toBe("Gallery storage");
  });

  it("uses Local-first Kavero storage copy when explicitly configured", () => {
    const copy = getSettingsCopy("local-first");

    expect(copy.deploymentProfile).toBe("local-first");
    expect(copy.overviewDescription).toContain("Kavero storage");
    expect(copy.storageStat).toEqual({
      value: "Kavero",
      helper: "Managed storage",
    });
    expect(copy.storageQuickActionLabel).toBe("Review storage");
    expect(copy.storagePanel.title).toBe("Kavero storage");
    expect(copy.storagePanel.summaryDescription).toContain("Google Drive is not required");
  });

  it("defaults invalid or differently cased profiles to Cloud", () => {
    expect(getSettingsCopy("LOCAL-FIRST").deploymentProfile).toBe("cloud");
    expect(getSettingsCopy("local first").deploymentProfile).toBe("cloud");
    expect(getSettingsCopy("self-hosted").deploymentProfile).toBe("cloud");
  });
});
