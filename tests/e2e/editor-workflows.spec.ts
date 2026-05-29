// M2.3 — focused E2E specs for the interactive editor workflows that the
// unit/component suites can't fully exercise: clone, undo/redo, the
// cross-fleet Compare (diff) modal, and the aggregated validation panel.
//
// Like smoke.spec.ts these drive the shipped single-file HTML over file://
// — the same artifact users open — so they catch wiring regressions between
// engine.js, the JSX, and the build.
import { test, expect, Page } from "@playwright/test";
import * as path from "node:path";

const FIXTURE_DIR = path.resolve(__dirname, "../../test-fixtures/v5");
const HTML_PATH = path.resolve(__dirname, "../../vcf-design-studio-v9.html");
const HTML_URL = "file:///" + HTML_PATH.replace(/\\/g, "/");

async function importFixture(page: Page, fileName: string) {
  const filePath = path.join(FIXTURE_DIR, fileName);
  await page.locator('input[type="file"]').first().setInputFiles(filePath);
  await page.waitForTimeout(250);
}

async function boot(page: Page) {
  await page.goto(HTML_URL);
  await expect(page.getByText("VCF", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
}

// The default fleet (engine.newFleet) ships one mgmt cluster named
// "mgmt-cluster-01" — a stable anchor for the editor workflows below.
const DEFAULT_CLUSTER = "mgmt-cluster-01";

// The cluster name <input> — located structurally so the locator survives
// value changes (React controlled inputs don't reflect typed values back to
// the `value` attribute, so an attribute selector would go stale on rename).
function clusterNameInput(page: Page) {
  return page.locator("input.text-base.font-serif.border-none").first();
}

test.describe("editor workflow — clone", () => {
  test.beforeEach(({ page }) => boot(page));

  test("cloning a cluster deep-copies it with a ' (copy)' suffix", async ({ page }) => {
    await expect(clusterNameInput(page)).toHaveValue(DEFAULT_CLUSTER);
    const clustersBefore = await page.locator("input.text-base.font-serif.border-none").count();

    const cloneBtn = page.getByTitle(/Duplicate this cluster/).first();
    await expect(cloneBtn).toBeVisible();
    await cloneBtn.click();

    // A new cluster card (hence a new font-serif name input) appears...
    await expect(page.locator("input.text-base.font-serif.border-none")).toHaveCount(clustersBefore + 1);
    // ...and one of the cluster name inputs now ends in " (copy)".
    await expect
      .poll(() =>
        page
          .locator("input.text-base.font-serif.border-none")
          .evaluateAll((els) =>
            els.some((e) => (e as HTMLInputElement).value.endsWith(" (copy)"))
          )
      )
      .toBe(true);
  });
});

test.describe("editor workflow — undo / redo", () => {
  test.beforeEach(({ page }) => boot(page));

  test("undo/redo buttons start disabled on a fresh fleet", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /Redo/ })).toBeDisabled();
  });

  test("undo reverts a rename and redo re-applies it", async ({ page }) => {
    const name = clusterNameInput(page);
    await expect(name).toHaveValue(DEFAULT_CLUSTER);

    await name.fill("renamed-cluster");
    await expect(name).toHaveValue("renamed-cluster");

    const undo = page.getByRole("button", { name: /Undo/ });
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(name).toHaveValue(DEFAULT_CLUSTER);

    const redo = page.getByRole("button", { name: /Redo/ });
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(name).toHaveValue("renamed-cluster");
  });
});

test.describe("editor workflow — Compare (diff) modal", () => {
  test.beforeEach(({ page }) => boot(page));

  test("opens, computes a structural diff against pasted JSON, and closes", async ({ page }) => {
    await page.getByRole("button", { name: "Compare Fleet" }).click();
    await expect(page.getByRole("heading", { name: "Compare Fleet" })).toBeVisible();

    await page.locator("textarea").fill('{"name":"Other Fleet"}');
    await page.getByRole("button", { name: /Compare against pasted JSON/ }).click();

    // The current fleet has many keys the pasted object lacks → "removed",
    // and the name differs → "changed".
    await expect(page.getByText(/\d+ removed/)).toBeVisible();
    await expect(page.getByText(/\d+ changed/)).toBeVisible();

    // Close via the × button; modal heading disappears.
    await page.getByRole("button", { name: "×" }).click();
    await expect(page.getByRole("heading", { name: "Compare Fleet" })).toHaveCount(0);
  });
});

test.describe("editor workflow — validation panel", () => {
  test.beforeEach(({ page }) => boot(page));

  test("renders a validation summary and expands issue detail when present", async ({ page }) => {
    await importFixture(page, "multi-instance-federated.json");

    const issuesToggle = page.getByRole("button", { name: /Validation Issues/ });
    const cleanBanner = page.getByText(/Fleet validation clean/);

    if (await issuesToggle.count()) {
      await issuesToggle.first().click();
      // Expanding reveals at least one severity section.
      await expect(
        page.getByText(/Critical \(blocks deployment\)|Errors|Warnings|Informational/).first()
      ).toBeVisible();
    } else {
      await expect(cleanBanner.first()).toBeVisible();
    }
  });
});
