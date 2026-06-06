// Capability Tray — import/export round-trip E2E.
//
// Verifies that the progressive-disclosure capability flags survive the
// design JSON export → re-import cycle, and that importing a legacy fixture
// (which predates the flags) flows the migration backfill into the export.
//
// Serves as an end-to-end check that import and export still work with the
// capability-gated UI: enabling a capability persists through Export JSON and
// re-reveals its panel on re-import; the design serialization round-trips.
import { test, expect, Page } from "@playwright/test";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

const FIXTURE_DIR = path.resolve(__dirname, "../../test-fixtures/v5");
const HTML_PATH = path.resolve(__dirname, "../../vcf-design-studio-v9.html");
const HTML_URL = "file:///" + HTML_PATH.replace(/\\/g, "/");

const EDGE_CHIP_ON = '[title="Enable NSX Edge + T0/BGP"]';
const EDGE_CHIP_OFF = '[title="Disable NSX Edge + T0/BGP"]';
const EDGE_PANEL_HEADING = "NSX Edge Cluster";

// Import a design JSON by setting the (first) hidden file input.
async function importDesign(page: Page, filePath: string) {
  await page.locator('input[type="file"]').first().setInputFiles(filePath);
  await page.waitForTimeout(300);
}

// Click Export JSON and return the parsed { version, exportedAt, fleet } object.
async function exportDesign(page: Page): Promise<any> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Export JSON$/ }).click(),
  ]);
  const dest = path.join(os.tmpdir(), `cap-export-${Date.now()}.json`);
  await download.saveAs(dest);
  const parsed = JSON.parse(fs.readFileSync(dest, "utf-8"));
  return { parsed, dest };
}

// Recursively find the first object that looks like an edgeCluster (has the
// shape we care about) and return its `enabled` value.
function firstClusterEdgeEnabled(fleet: any): boolean | undefined {
  const clusters = fleet?.instances?.[0]?.domains?.[0]?.clusters || [];
  return clusters[0]?.edgeCluster?.enabled;
}

test.describe("Capability Tray — import/export round-trip", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HTML_URL);
    await expect(page.getByText("VCF", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("enabling a capability persists through Export JSON and re-reveals on re-import", async ({ page }) => {
    // Default fleet: edge capability off → panel hidden.
    await expect(page.getByText(EDGE_PANEL_HEADING)).toHaveCount(0);

    // Enable the NSX Edge chip → panel reveals.
    await page.locator(EDGE_CHIP_ON).first().click();
    await expect(page.getByText(EDGE_PANEL_HEADING).first()).toBeVisible();

    // Export JSON and confirm the flag persisted in the serialized fleet.
    const { parsed, dest } = await exportDesign(page);
    expect(parsed.fleet).toBeTruthy();
    expect(firstClusterEdgeEnabled(parsed.fleet)).toBe(true);

    // Re-import the exported design into a fresh app load → panel must reveal
    // again (the enabled flag round-tripped through migrateFleet).
    await page.goto(HTML_URL);
    await expect(page.getByText("VCF", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(EDGE_PANEL_HEADING)).toHaveCount(0); // fresh load: hidden
    await importDesign(page, dest);
    await expect(page.getByText(EDGE_PANEL_HEADING).first()).toBeVisible();

    fs.unlinkSync(dest);
  });

  test("a fresh design round-trips with optional panels staying hidden", async ({ page }) => {
    // Export the default fleet and re-import → edge panel stays hidden
    // (edge defaults off; the round-trip must not spuriously enable it).
    const { parsed, dest } = await exportDesign(page);
    expect(firstClusterEdgeEnabled(parsed.fleet)).toBe(false);

    await page.goto(HTML_URL);
    await expect(page.getByText("VCF", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await importDesign(page, dest);
    await expect(page.getByText(EDGE_PANEL_HEADING)).toHaveCount(0);

    fs.unlinkSync(dest);
  });

  test("importing a legacy fixture flows migration backfill into the export", async ({ page }) => {
    // minimal-simple.json is a v5 fixture that predates the capability flags.
    await importDesign(page, path.join(FIXTURE_DIR, "minimal-simple.json"));
    await expect(page.locator('input[value="Minimal Simple Fleet"]')).toBeVisible();

    const { parsed, dest } = await exportDesign(page);
    // Migration backfill must have populated the new flags:
    expect(parsed.fleet.vcfOpsEnabled).toBe(true); // scalar default-on
    // Optional cluster capability defaults to false (no data in the fixture):
    expect(firstClusterEdgeEnabled(parsed.fleet)).toBe(false);

    fs.unlinkSync(dest);
  });
});
