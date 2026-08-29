import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), ...path.split("/")), "utf8");
}

describe("open-source product access contract", () => {
  it("drops database entitlement triggers and tier-specific canvas cleanup", () => {
    const schema = source("supabase/schema.sql");

    expect(schema).toContain("drop trigger if exists canvas_assets_limit on public.canvas_assets;");
    expect(schema).toContain("drop function if exists public.enforce_canvas_asset_limit();");
    expect(schema).toContain("drop trigger if exists prompt_templates_limit on public.prompt_templates;");
    expect(schema).toContain("drop function if exists public.enforce_prompt_template_limit();");
    expect(schema).toContain("drop function if exists public.delete_inactive_free_canvas_data(interval);");
    expect(schema).not.toContain("create trigger canvas_assets_limit");
    expect(schema).not.toContain("create trigger prompt_templates_limit");
    expect(schema).not.toContain("create or replace function public.delete_inactive_free_canvas_data");
  });

  it("keeps technical file-size bounds without product-count caps", () => {
    const canvasApi = source("src/lib/canvas/api.ts");
    const assetRoute = source("src/app/api/canvas/assets/route.ts");
    const legacyUploadRoute = source("src/app/api/uploads/route.ts");
    const designRoute = source("src/app/canvas/api/designs/route.ts");
    const pageRoute = source("src/app/canvas/api/designs/[id]/pages/route.ts");

    expect(canvasApi).toContain("driveAssetBytesPerFile: 10 * 1024 * 1024");
    for (const runtimeSource of [canvasApi, assetRoute, legacyUploadRoute, designRoute, pageRoute]) {
      expect(runtimeSource).not.toMatch(/designsPerUser|pagesPerDesign|driveAssetsPerUser/);
    }
  });

  it("does not retain upgrade or tier-limit copy in product surfaces", () => {
    const productCopy = [
      source("src/modules/canvas/components/home.tsx"),
      source("src/app/gallery/page.tsx"),
      source("src/app/settings/settings-copy.ts"),
      source("src/app/settings/page.tsx"),
      source("src/app/settings/storage/storage-settings-panel.tsx"),
    ].join("\n");

    expect(productCopy).not.toMatch(/upgrade|premium storage|free plan|view subscription/i);
  });
});
