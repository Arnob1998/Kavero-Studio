import { describe, expect, it } from "vitest";
import { getSettingsCopy } from "./settings-copy";

describe("settings copy", () => {
  it("uses Cloud storage and subscription copy by default", () => {
    const copy = getSettingsCopy();

    expect(copy.deploymentProfile).toBe("cloud");
    expect(copy.overviewDescription).toContain("subscription");
    expect(copy.storageStat).toEqual({
      value: "Drive",
      helper: "Free plan archive",
    });
    expect(copy.storageQuickActionLabel).toBe("Connect storage");
    expect(copy.subscriptionQuickActionLabel).toBe("View subscription");
    expect(copy.storagePageDescription).toContain("Google Drive");
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
    expect(copy.subscriptionQuickActionLabel).toBe("View account details");
    expect(copy.storagePanel.title).toBe("Kavero storage");
    expect(copy.storagePanel.summaryDescription).toContain("Google Drive is not required");
  });

  it("defaults invalid or differently cased profiles to Cloud", () => {
    expect(getSettingsCopy("LOCAL-FIRST").deploymentProfile).toBe("cloud");
    expect(getSettingsCopy("local first").deploymentProfile).toBe("cloud");
    expect(getSettingsCopy("self-hosted").deploymentProfile).toBe("cloud");
  });
});
