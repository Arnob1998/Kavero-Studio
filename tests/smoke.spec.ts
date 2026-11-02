import { expect, test } from "@playwright/test";

test("opens the public homepage and its Dashboard entry", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Kavero/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Design with AI. Keep control of your work.");
  await expect(page.getByRole("link", { name: /Start designing free/ }).first()).toHaveAttribute("href", "/dashboard");
  await page.getByRole("link", { name: /Start designing free/ }).first().click();
  await expect(page).toHaveURL(/\/auth\/login\?next=%2Fdashboard/);
});

test("starts the Generate route", async ({ page }) => {
  await page.goto("/generate");

  await expect(page).toHaveTitle(/Generate \| Kavero/);
  await expect(page.getByRole("heading", { name: "Kavero" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate", exact: true })).toBeVisible();
});
