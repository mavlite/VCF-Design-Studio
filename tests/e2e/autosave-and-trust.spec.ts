// Pre-launch resilience & trust — real-browser E2E.
//
// Validates in an actual Chromium (not JSDOM) that:
//   1. The privacy note renders on load.
//   2. A design autosaves to localStorage and is restored across a page reload,
//      with the "Restored your previous design" banner — proving the
//      localStorage round-trip + the ErrorBoundary-wrapped mount work in the
//      shipped artifact.
import { test, expect } from "@playwright/test";
import * as path from "node:path";

const HTML_PATH = path.resolve(__dirname, "../../vcf-design-studio-v9.html");
const HTML_URL = "file:///" + HTML_PATH.replace(/\\/g, "/");

test.describe("pre-launch resilience & trust", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HTML_URL);
    await expect(page.getByText("VCF", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    // Clean slate so a prior run's autosave can't leak into this one.
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.reload();
    await expect(page.getByText("VCF", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("the privacy note is visible on load", async ({ page }) => {
    await expect(page.getByText(/processing happens in your browser/i)).toBeVisible();
    await expect(page.getByText(/never uploaded/i)).toBeVisible();
  });

  test("a fresh visit shows no restore banner", async ({ page }) => {
    await expect(page.getByText(/Restored your previous design/i)).toHaveCount(0);
  });

  test("a design autosaves and is restored across reload", async ({ page }) => {
    const nameInput = page.locator('input[value="Production Fleet"]').first();
    await expect(nameInput).toBeVisible();
    await nameInput.fill("Autosave RoundTrip Fleet");
    await page.waitForTimeout(900); // past the 750ms autosave debounce

    await page.reload();
    await expect(page.getByText("VCF", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

    // The edited design persisted, and the restore banner is shown.
    await expect(page.locator('input[value="Autosave RoundTrip Fleet"]')).toBeVisible();
    await expect(page.getByText(/Restored your previous design/i)).toBeVisible();

    // "Start fresh" clears it back to a new design + removes the banner.
    await page.getByRole("button", { name: /Start fresh/i }).click();
    await expect(page.locator('input[value="Production Fleet"]').first()).toBeVisible();
    await expect(page.getByText(/Restored your previous design/i)).toHaveCount(0);

    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  });
});
