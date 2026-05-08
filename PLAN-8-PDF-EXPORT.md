# Plan 8 — PDF Export Capability

> **Branches:** stacked sequence — `plan-8a-report-metadata` → `plan-8b-print-view` → `plan-8c-pdfmake` (optional)
> **Goal:** Deliver the fleet design as a polished, multi-page PDF for client delivery — text-selectable, vector graphics, fast, and small enough to email.
> **Status:** PR 8a in progress; PRs 8b/8c not yet started.

This file is the source of truth for resuming Plan 8 across sessions. Captures the design, decisions made under independent multi-agent review, the 3-PR decomposition, and exactly where to pick up.

---

## 1. Approach (post-review revision)

The original draft proposed `html2pdf.js` (canvas → PDF). Three independent agent reviews (architect, performance, code-review) **unanimously rejected that approach** and recommended `window.print()` as the primary path.

**Decision:** **`window.print()` + `@media print` CSS as primary.** Vector PDF, text-selectable, native browser, sub-2s for any fleet, ~0KB bundle, perfect SVG fidelity.

**Why not `html2pdf.js`:**
- Image-based PDFs — IPs and hostnames not selectable, no Ctrl-F (the IP plan section is the entire point)
- SVG topology fidelity broken: inline `IBM Plex Mono` / `Inter` fonts fall back to system mono/sans during foreignObject rasterization
- 60–120s generation on the enterprise fixture (4,000–6,000 DOM elements)
- 27–56MB output at print-quality 144 DPI — over Gmail's 25MB attachment limit
- ~200MB peak memory during generation, 5–10% failure rate on constrained machines

**Why not `pdfmake` first:**
- Requires translating layout data into pdfmake's declarative format — significant duplication
- Browser print already covers the deliverable need
- Reserve as fallback (PR 8c) only if browser print reveals concrete gaps

**Why not server-side (Puppeteer):**
- Single-HTML-file constraint rules it out

## 2. Decomposition into 3 PRs

### PR 8a — Schema: `fleet.reportMetadata` (~250 LOC) — IN PROGRESS

Persisted client/project metadata so the cover page survives JSON round-trip.

**Schema:**
```js
fleet.reportMetadata = {
  clientName: "",      // e.g. "Acme Corp"
  projectId: "",       // e.g. "VCF-2026-Q2"
  preparedBy: "",      // e.g. "J. Smith, Solutions Architect"
  revision: "",        // e.g. "Draft 2", "v1.0"
  documentDate: "",    // ISO date string (YYYY-MM-DD); empty = use today at print time
}
```

All fields default to empty strings — opt-in via the Fleet Summary UI panel.

**Engine:**
- New `createFleetReportMetadata()` factory in `engine.js`
- `newFleet()` includes `reportMetadata: createFleetReportMetadata()`
- `migrateV5ToV6` and `migrateFleet` final pass backfill with empty defaults
- Export to `VcfEngine` symbols + `EXPECTED_SYMBOLS` in `engine-smoke.test.js`

**UI:**
- New "Report Metadata" section in `FleetSummary` (vcf-design-studio-v6.jsx) alongside the Fleet Network Configuration and Naming Conventions sections
- Five text inputs (clientName, projectId, preparedBy, revision, documentDate)
- documentDate input has a "Today" button that fills in the current ISO date

**Tests** (`tests/unit/report-metadata.test.js`):
- Factory default returns empty strings for all fields
- `newFleet()` includes `reportMetadata`
- Migration backfills missing field
- JSON export preserves explicit values
- Migration is idempotent
- Round-trip preserves user-set values

### PR 8b — Print view + CSS (~600 LOC) — NOT STARTED

Refactor cluster/T0/IP/topology JSX into shared section components with a `mode: "edit" | "print"` prop. Editor and print view compose the same components — single source of truth, no parallel render tree, no drift as schema evolves.

**Component extraction targets:**
- `<ClusterSummary cluster mode="edit|print">` — replaces inline cluster body in ClusterCard for `mode="edit"`, used by PrintView for `mode="print"`
- `<IpPlanTable cluster fleet instance domain mode>` — already mostly extractable from existing `IpGrid`
- `<NicDiagram cluster mode>` — extract from existing JSX
- `<T0Diagram cluster mode>` — extract from existing JSX
- `<ApplianceStackTable stack mode>` — render infraStack/wldStack in tabular form
- `<ValidationIssuesList issues>` — group by severity for the report

**PrintView component:**
- Renders cover page (uses `fleet.reportMetadata`), TOC, exec summary, per-instance/domain/cluster sections, network summary, topology diagrams, per-site capacity, validations, appliance inventory
- Hidden in normal view via CSS class `print-view-only`
- Revealed only during print preview

**Print CSS** (`@media print`):
- A4 default; `@page` rules for margins
- `page-break-before: always` on each section root
- `page-break-inside: avoid` for short tables
- Hide editor chrome (tabs, action buttons, action panels)
- Reveal `.print-view-only`
- Lock page numbers via CSS counters
- Force light backgrounds (Tailwind dark-mode utilities → white)
- Lock locale-sensitive output to `en-US` (use `Intl.NumberFormat("en-US")` for all numbers in print mode)

**UI:**
- New "Print / Save as PDF" button alongside Export JSON / Installer JSON / Workbook CSV
- Triggers `window.print()` after revealing PrintView

**Tests:**
- Snapshot test of PrintView's rendered HTML output (vitest + happy-dom)
- Manifest test asserting every `cluster.*` field used in `emitInstallerJson` / `emitWorkbookRows` also appears in PrintView's render (prevents drift)
- Playwright test that triggers print preview and verifies the rendered DOM contains expected sections

### PR 8c — pdfmake (optional, ~300 LOC) — DEFER

Only if PR 8b reveals concrete gaps (programmatic page numbers beyond CSS counters, watermarks, programmatic TOC with anchored page numbers, custom branding/logo embedding).

**Library:** pdfmake (~170KB, declarative, text-native, sub-second).

**Critical:** library bundled into HTML via `build-html.mjs`, **not loaded from CDN**. Code review flagged that air-gapped client networks are the primary use case — a CDN fetch would silently fail.

## 3. Decisions made (locked unless revisited)

| # | Decision | Rationale |
|---|---|---|
| 1 | `window.print()` primary, `pdfmake` deferred | Convergent agent recommendation; vector + text-selectable + sub-2s |
| 2 | NO `html2pdf.js` | Image-based PDF breaks core deliverable use case |
| 3 | NO `emitReportData` engine helper | YAGNI ceremony; PrintView reads `(fleet, fleetResult)` directly via shared section components |
| 4 | NO parallel PrintView tree | Use shared `<ClusterSummary mode>` components with editor — single source of truth |
| 5 | Bundle libs into HTML, not CDN | Air-gapped networks are the primary use case |
| 6 | Lock printed output to `en-US` locale | Client deliverables need predictable formatting |
| 7 | Decompose into 3 PRs | Plan 7's 1180 LOC was the largest yet; 3-way split limits risk |

## 4. Open decisions for the user

| # | Decision | Default | Notes |
|---|---|---|---|
| 1 | A4 vs Letter default | A4 | User can override via the print dialog regardless |
| 2 | Cover page logo | Defer to v2 | v1 cover uses `fleet.reportMetadata` text fields only |
| 3 | Build PR 8c at all? | Defer until 8b ships | Only build if browser print reveals gaps |
| 4 | Validation gate on print? | No | Match existing exporters that don't gate on issues |

## 5. Implementation status

| PR | Step | Status |
|---|---|:---:|
| 8a | Schema + factory + migration | 🚧 In progress |
| 8a | Fleet Summary UI section | ⏳ Pending |
| 8a | Tests + push | ⏳ Pending |
| 8b | Component extraction (ClusterSummary, IpPlanTable, etc.) | ⏳ Pending |
| 8b | PrintView component | ⏳ Pending |
| 8b | `@media print` CSS | ⏳ Pending |
| 8b | "Print / Save as PDF" button | ⏳ Pending |
| 8b | Snapshot + manifest + E2E tests | ⏳ Pending |
| 8c | pdfmake bundled (optional) | 📋 Deferred |
| — | README "PDF Export" section | ⏳ Pending (8b) |

## 6. Resuming on another machine

```bash
git fetch origin
git checkout plan-8a-report-metadata     # or plan-8b-print-view if 8a merged
npm install
npm test                                  # confirm all green
npm run build-html                        # confirm HTML in sync
cat PLAN-8-PDF-EXPORT.md                  # this file
```

**If picking up 8a from this state:** see "PR 8a — Schema" above. Engine factory + migration are the load-bearing parts; the UI inputs are simple wrappers over `setFleet({ ...fleet, reportMetadata: { ...fleet.reportMetadata, [field]: value } })`.

**If picking up 8b from a fresh tree:** start by extracting `<ClusterSummary>` from the existing ClusterCard. Move the read-only render bits (cluster header, hardware spec, sizing math, storage policy, T0 list, NIC profile, IP plan, BGP) into a new component that accepts a `mode` prop. Editor mode keeps interactive controls; print mode renders pure tables. Then compose the same component in PrintView. CSS comes last.

## 7. Risks carried forward

1. **Print CSS effort.** App has zero `@media print` rules today. Tailwind utilities + dark-background sections need explicit overrides for print. Realistic effort: 2-5 days of focused front-end work in PR 8b.
2. **SVG topology width.** Existing topology SVGs render at viewport-derived widths. Print needs a fixed page-fitted width. Add `max-width: 7.5in; width: 100%; height: auto` overrides in `@media print`.
3. **Long-table page breaks.** IP plan tables for 64-host clusters break across pages. Use `thead` + `tbody { page-break-inside: auto; }` + `tr { page-break-inside: avoid; }` and ensure `<thead>` repeats on each page (`display: table-header-group`).
4. **Browser-specific print quirks.** Chrome and Firefox both honor `@page` margins; Safari is finicky. Test in Chrome primarily; document Safari quirks in README.

## 8. Files referenced for PR 8b component extraction

- [vcf-design-studio-v6.jsx](vcf-design-studio-v6.jsx) `function ClusterCard` — the source of `<ClusterSummary>` extraction
- [vcf-design-studio-v6.jsx](vcf-design-studio-v6.jsx) `function IpGrid` — already a standalone component; rename to `IpPlanTable` and add `mode` prop
- [vcf-design-studio-v6.jsx](vcf-design-studio-v6.jsx) `function computeTopologyLayout` and `function TopologyView` — wrap the SVG in a print-friendly container
- [vcf-design-studio-v6.jsx](vcf-design-studio-v6.jsx) `function computePhysicalLayout` and `function PhysicalTopologyView` — same
- [vcf-design-studio-v6.jsx](vcf-design-studio-v6.jsx) `function FleetSummary` — landing site for the new "Report Metadata" section in PR 8a
- [engine.js](engine.js) — factory + migration insertion points (look for `createFleetNamingConfig` for the analogous Plan 7 pattern)

## Appendix A — Cover page mock

```
+-----------------------------------------------------------+
|                                                           |
|   VMware Cloud Foundation 9                               |
|   Fleet Design Document                                   |
|                                                           |
|   ───────────────────────                                 |
|   {fleet.name}                                            |
|                                                           |
|   Client:        {fleet.reportMetadata.clientName}        |
|   Project:       {fleet.reportMetadata.projectId}         |
|   Prepared by:   {fleet.reportMetadata.preparedBy}        |
|   Revision:      {fleet.reportMetadata.revision}          |
|   Document date: {fleet.reportMetadata.documentDate}      |
|                                                           |
|   ───────────────────────                                 |
|   {N} sites · {M} VCF instances · {H} total hosts         |
|   {C} total cores licensed · {T} TiB raw vSAN              |
|                                                           |
+-----------------------------------------------------------+
```
