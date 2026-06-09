// Workbook (.xlsx) export E2E — stamps the pristine Broadcom Planning &
// Preparation Workbook end-to-end and validates the produced file.
//
// Confirms the export pipeline still works with the capability-tray model:
//   1. A default (all-optional-off) design exports a valid stamped .xlsx.
//   2. A design with capabilities enabled (edge + supervisor) also exports a
//      valid .xlsx — phase-1 export is visibility-only, so enabling/revealing
//      capabilities must not break the workbook stamp.
//
// The pristine workbooks live at the repo root (vcf-9.{0,1}-planning-and-
// preparation-workbook.xlsx). The default fleet targets 9.1.
import { test, expect } from "./_fixtures";
import type { Page } from "@playwright/test";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

const ROOT = path.resolve(__dirname, "../..");
const HTML_PATH = path.join(ROOT, "vcf-design-studio-v9.html");
const HTML_URL = "file:///" + HTML_PATH.replace(/\\/g, "/");
const PRISTINE_91 = path.join(ROOT, "vcf-9.1-planning-and-preparation-workbook.xlsx");

// Open the export modal, drop the pristine 9.1 workbook, click Export, and
// return the saved path of the downloaded stamped .xlsx.
async function exportWorkbook(page: Page): Promise<string> {
  await page.getByRole("button", { name: /Export VCF 9\.1 Workbook \(\.xlsx\)/ }).click();
  // Modal pristine-workbook input is the .xlsx-only file input.
  await page.locator('input[accept=".xlsx"]').setInputFiles(PRISTINE_91);
  // acceptPristineWorkbook reads + validates the pristine workbook (Sheet2!J16)
  // asynchronously and stores it in a ref (no DOM signal on success). Give the
  // ~884K parse time to complete, then confirm no validation error surfaced.
  await page.waitForTimeout(6000);
  await expect(page.getByText(/No pristine workbook loaded|Export failed|version mismatch|Couldn't (detect|parse)/i)).toHaveCount(0);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Export$/ }).click(),
  ]);
  const dest = path.join(os.tmpdir(), `wb-export-${Date.now()}.xlsx`);
  await download.saveAs(dest);
  return dest;
}

// A stamped workbook must be a real, non-trivial .xlsx (ZIP: "PK" signature).
function assertValidXlsx(filePath: string) {
  const buf = fs.readFileSync(filePath);
  expect(buf.length).toBeGreaterThan(50_000); // stamped workbook is sizable
  expect(buf[0]).toBe(0x50); // 'P'
  expect(buf[1]).toBe(0x4b); // 'K' — ZIP/xlsx signature
}

test.describe("Workbook .xlsx export with the capability-tray model", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HTML_URL);
    await expect(page.getByText("VCF", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("default design (all optional capabilities off) exports a valid .xlsx", async ({ page }) => {
    const dest = await exportWorkbook(page);
    assertValidXlsx(dest);
    fs.unlinkSync(dest);
  });

  test("design with capabilities enabled (edge + supervisor) exports a valid .xlsx", async ({ page }) => {
    // Reveal + enable two cluster capabilities via the tray chips.
    await page.locator('[title="Enable NSX Edge + T0/BGP"]').first().click();
    await expect(page.getByText("NSX Edge Cluster").first()).toBeVisible();
    await page.locator('[title="Enable vSphere Supervisor (VKS)"]').first().click();

    const dest = await exportWorkbook(page);
    assertValidXlsx(dest);
    fs.unlinkSync(dest);
  });
});
