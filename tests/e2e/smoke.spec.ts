// Smoke E2E — loads the shipped HTML and verifies the main UI shell renders,
// fixtures can be imported, and the topology view switches cleanly.
import { test, expect, Page } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";

const FIXTURE_DIR = path.resolve(__dirname, "../../test-fixtures/v5");
const HTML_PATH = path.resolve(__dirname, "../../vcf-design-studio-v9.html");
const HTML_URL = "file:///" + HTML_PATH.replace(/\\/g, "/");

// Small helper — import a fixture by triggering the hidden file input.
async function importFixture(page: Page, fileName: string) {
  const filePath = path.join(FIXTURE_DIR, fileName);
  const fileChooser = page.locator('input[type="file"]').first();
  await fileChooser.setInputFiles(filePath);
  await page.waitForTimeout(250);
}

test.describe("VCF Design Studio — smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HTML_URL);
    await expect(page.getByText("VCF", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("loads and shows the three main tabs", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^Editor$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Topology Diagram$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Per-Site View$/ })).toBeVisible();
  });

  test("fleet-header controls render (pathway, federation, SSO)", async ({ page }) => {
    await expect(page.getByText("Deployment Pathway").first()).toBeVisible();
    await expect(page.getByText("NSX Federation").first()).toBeVisible();
    await expect(page.getByText("SSO Model").first()).toBeVisible();
  });

  test("imports minimal-simple fixture and shows the fleet name", async ({ page }) => {
    await importFixture(page, "minimal-simple.json");
    // The fleet name lives in a text input bound to fleet.name. Locate it
    // and assert its value — getByDisplayValue isn't available in this
    // Playwright version, so we use a value-based locator.
    const input = page.locator('input[value="Minimal Simple Fleet"]');
    await expect(input).toBeVisible();
  });

  test("topology overlay panels render after fixture import", async ({ page }) => {
    await importFixture(page, "multi-instance-federated.json");
    await page.getByRole("button", { name: /^Topology Diagram$/ }).click();
    await expect(page.getByText("T0 Gateways").first()).toBeVisible();
    await expect(page.getByText("SSO Topology")).toBeVisible();
    await expect(page.getByText("DR Pairs")).toBeVisible();
    await expect(page.getByText("NSX Federation").nth(1)).toBeVisible();
  });

  test("per-site view renders shared appliances section", async ({ page }) => {
    await importFixture(page, "stretched-50-50.json");
    await page.getByRole("button", { name: /^Per-Site View$/ }).click();
    await expect(page.getByText(/Shared Appliances/).first()).toBeVisible();
  });

  // Theme 19 — AZ2 Networks panel renders only on stretched clusters.
  test("AZ2 Networks panel renders on a stretched fixture but not on a non-stretched one", async ({ page }) => {
    await importFixture(page, "stretched-50-50.json");
    // Stretched fixture should show the AZ2 panel header at least once
    await expect(page.getByText(/AZ2 Networks/).first()).toBeVisible();
    // The architect-recommended "Copy MTU from AZ1" button must be present
    await expect(page.getByRole("button", { name: /Copy MTU from AZ1/ }).first()).toBeVisible();

    // Now load a non-stretched fixture in the same session and confirm
    // the AZ2 panel disappears.
    await importFixture(page, "minimal-simple.json");
    await expect(page.getByText(/AZ2 Networks/)).toHaveCount(0);
  });
});

test.describe("VCF Design Studio — fixture import round-trip", () => {
  test("all v5 fixtures load without breaking the UI shell", async ({ page }) => {
    test.setTimeout(120_000);
    const fixtures = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));
    for (const fixture of fixtures) {
      await page.goto(HTML_URL);
      await expect(page.getByText("VCF", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
      await importFixture(page, fixture);
      // If the React tree crashed, the main header would be replaced.
      await expect(page.getByText("VCF", { exact: false }).first()).toBeVisible();
    }
  });
});

test.describe("VCF Design Studio — network tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HTML_URL);
    await expect(page.getByText("VCF", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("network tab renders NIC diagram and VLAN map", async ({ page }) => {
    await page.getByRole("button", { name: /^Network$/ }).click();

    // Scope to the on-screen <h2> headings — Plan 9's PrintView is always
    // mounted (hidden in screen mode by CSS) and contains <h4> elements
    // with the same text, which would otherwise trigger strict-mode
    // multi-match failures.
    await expect(page.getByRole("heading", { level: 2, name: "Physical NIC Topology" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "VLAN & Subnet Map" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "NSX Edge / T0 Topology" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Per-Host IP Assignments" })).toBeVisible();

    const svgs = page.locator("svg");
    await expect(svgs.first()).toBeVisible();
  });
});

// Plan 8b — Print/Save as PDF
//
// PrintView is always-mounted but hidden in screen mode by the .print-view
// CSS rule. Visibility flips during @media print. We can't fully drive the
// browser print dialog from Playwright, but we can verify:
//   1. The button is wired and clicking it doesn't throw
//   2. PrintView exists in the DOM with the expected sections
//   3. Switching media to "print" actually reveals it (CSS round-trip)
test.describe("VCF Design Studio — print view", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HTML_URL);
    await expect(page.getByText("VCF", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("Print/Save as PDF button is present and PrintView is in the DOM", async ({ page }) => {
    const btn = page.getByRole("button", { name: /Print \/ Save as PDF/ });
    await expect(btn).toBeVisible();
    // PrintView itself is hidden in screen mode but mounted in the DOM.
    const printRoot = page.locator(".print-view").first();
    await expect(printRoot).toBeAttached();
  });

  test("PrintView contains expected sections in the DOM", async ({ page }) => {
    await importFixture(page, "minimal-ha.json");
    // PrintView is hidden in screen mode by CSS, but its DOM nodes exist.
    // toBeAttached checks DOM presence without requiring visibility.
    await expect(page.locator(".print-view").first()).toBeAttached();
    await expect(page.getByText("Fleet Design Document").first()).toBeAttached();
    await expect(page.getByText("Executive Summary").first()).toBeAttached();
    // Topology + per-site sections (added after the blank-PDF fix)
    await expect(page.getByText("Fleet Topology — Logical View").first()).toBeAttached();
    await expect(page.getByText("Fleet Topology — Physical View").first()).toBeAttached();
    await expect(page.getByText("Per-Site Capacity").first()).toBeAttached();
    await expect(page.getByText("Fleet Appliance Inventory").first()).toBeAttached();
    await expect(page.getByText("Validation Issues").first()).toBeAttached();
  });

  test("PrintView includes inline SVG diagrams (topology + per-cluster NIC/T0)", async ({ page }) => {
    await importFixture(page, "minimal-ha.json");
    // Each topology section contains a top-level <svg> via .print-svg.
    // Per-cluster NIC + T0 diagrams render as SVGs inside .print-diagram.
    const topoSvgs = await page.locator(".print-view .print-svg").count();
    expect(topoSvgs).toBeGreaterThanOrEqual(1); // at least logical topology
    const clusterSvgs = await page.locator(".print-view .print-diagram svg").count();
    expect(clusterSvgs).toBeGreaterThanOrEqual(1); // at least one NIC diagram
  });

  test("Plan 9: physical topology renders a fleet-wide SVG on a landscape page", async ({ page }) => {
    await importFixture(page, "stretched-50-50.json");
    // After the landscape revision, the physical topology renders a single
    // fleet-wide SVG (.print-svg-fleet) rather than per-site cards. The
    // section is marked .print-landscape so the @page rule rotates it.
    const fleetSvg = await page.locator(".print-view .print-svg-fleet").count();
    expect(fleetSvg).toBe(1);
    const landscapePages = await page.locator(".print-view .print-landscape").count();
    expect(landscapePages).toBeGreaterThanOrEqual(2); // logical + physical
  });

  test("Plan 9: cover scope panel shows the 8 stat tiles", async ({ page }) => {
    // Cover scope grid is always rendered (even with empty fleet); count
    // the .print-stat tiles.
    const stats = await page.locator(".print-cover-scope .print-stat").count();
    expect(stats).toBe(8);
  });

  test("Plan 9: design highlights surface stretched/brownfield/etc.", async ({ page }) => {
    // stretched-50-50 has a stretched mgmt domain → highlights row should
    // appear. minimal-simple has no highlights → no row.
    await importFixture(page, "stretched-50-50.json");
    const text = await page.locator(".print-view").textContent();
    expect(text).toMatch(/Stretched domains/);
  });

  test("Plan 9: empty IP plan and empty network rows are suppressed", async ({ page }) => {
    // The default empty fleet has no networks configured. The print view
    // should NOT contain an empty per-host IP plan header. Search for the
    // exact phrase only the populated table emits.
    const text = await page.locator(".print-view").textContent();
    expect(text).not.toMatch(/Per-host IP plan[\s\S]{0,200}Hostname[\s\S]{0,200}Mgmt IP/);
  });

  test("print media stylesheet flips PrintView to display:block", async ({ page }) => {
    // Verify the @media print CSS rules are applied — the most direct way is
    // to read computed style after emulating print media. Toggling visibility
    // checks under emulateMedia is brittle; computed style is deterministic.
    await page.emulateMedia({ media: "print" });
    const display = await page.locator(".print-view").first().evaluate(
      (el) => window.getComputedStyle(el).display
    );
    expect(display).toBe("block");

    // Editor chrome should be effectively hidden under print media.
    // Direct children of .print-root other than .print-view are hidden via
    // `display: none`. Verify by checking the <header> element (a known
    // direct child) has computed display "none".
    const headerDisplay = await page.evaluate(() => {
      const h = document.querySelector(".print-root > header");
      return h ? window.getComputedStyle(h).display : "missing";
    });
    expect(headerDisplay).toBe("none");
  });

  test("PrintView ancestors are NOT hidden — cover content actually paints (regression: blank PDF)", async ({ page }) => {
    // Earlier the @media print CSS used `body > *:not(.print-root)` which
    // hid the React mount point (<div id="root">) and cascade-hid the
    // PrintView. Result: blank PDFs. This regression test asserts every
    // ancestor of .print-view has non-"none" computed display under print
    // media, AND that the cover title has non-zero rendered size.
    await page.emulateMedia({ media: "print" });

    const ancestorChain = await page.evaluate(() => {
      const pv = document.querySelector(".print-view");
      if (!pv) return ["missing"];
      const out = [];
      let el = pv;
      while (el && el !== document.documentElement) {
        out.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          className: el.className || null,
          display: window.getComputedStyle(el).display,
        });
        el = el.parentElement;
      }
      return out;
    });
    // No ancestor (or self) should be display: none.
    for (const node of ancestorChain) {
      expect(node.display, `ancestor ${node.tag}#${node.id || ""}.${node.className || ""} should not be display:none`)
        .not.toBe("none");
    }

    // Cover title must have non-zero painted size (clientWidth > 0).
    const coverWidth = await page.evaluate(() => {
      const h1 = document.querySelector(".print-title");
      return h1 ? h1.getBoundingClientRect().width : 0;
    });
    expect(coverWidth).toBeGreaterThan(0);
  });

  test("PrintView cover meta table includes the labeled fields", async ({ page }) => {
    // Field labels are present even when values are empty (rendered as —).
    await expect(page.locator(".print-cover-meta")).toBeAttached();
    const labels = await page.locator(".print-cover-meta th").allTextContents();
    expect(labels).toContain("Client");
    expect(labels).toContain("Project");
    expect(labels).toContain("Prepared by");
    expect(labels).toContain("Revision");
    expect(labels).toContain("Document date");
  });
});
