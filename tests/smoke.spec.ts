import { expect, test } from "@playwright/test";

test("starts the Kavero home route", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Kavero/);
  await expect(page.getByRole("heading", { name: "Kavero" })).toBeVisible();
  await expect(page.getByRole("button", { name: /New Design/i })).toBeVisible();
});

test("starts the Generate route", async ({ page }) => {
  await page.goto("/generate");

  await expect(page).toHaveTitle(/Generate \| Kavero/);
  await expect(page.getByRole("heading", { name: "Kavero" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate", exact: true })).toBeVisible();
});
