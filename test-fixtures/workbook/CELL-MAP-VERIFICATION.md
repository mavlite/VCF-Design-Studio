# Cell-Map Verification — human sign-off

This document is the human sign-off gate for the workbook cell-map in
[engine.js](../../engine.js) (`WORKBOOK_CELL_MAP` constant). A human
implementer signs off after opening each pristine workbook in Excel and
visually confirming that every cell-map target points to the correct
user-input cell (column L or D, never K or C). The automated gate
(`scripts/verify-cell-map.mjs`) checks label text but cannot catch a
wrong-column target.

## Status: Phase 1a complete — automated gate green; human sign-off pending

Phase 0 extraction ran 2026-05-20 against the workbooks identified by the
SHA-256 sums below; re-extraction on 2026-05-21 corrected the column
convention for "Deploy Workload Domain" and "Deploy Cluster" sheets
(B=label, D=value — same as the Configure sheets, not the C=label / B=value
the original extractor assumed). `WORKBOOK_CELL_MAP` was authored as a
~29-entry strategic subset covering every scope (per-fleet, instance,
mgmt-domain, mgmt-cluster, mgmt-cluster-host, initial-instance-mgmt-cluster,
workload-domain, workload-cluster, additional-cluster) and every version-
routing pattern (`cellByVersion`, `cellPatternByVersion`, version-scoped
`workbookVersions`, `verifyLabel` / `verifyLabelByVersion` overrides).
`scripts/verify-cell-map.mjs` reports clean (0 errors / 0 warnings) across
48 entry/version combinations. **Phase 1.5 human sign-off — visual
walk-through of every cell-map target in Excel — remains pending and gates
PR 3.**

## Reference pristine workbooks

| Version | SHA-256 | Source |
|---|---|---|
| 9.0 | `6916a8d5bf36…` (see `workbook-cell-meta-9.0.json` for full hash) | `vcf-9.0-planning-and-preparation-workbook.xlsx` from Broadcom techdocs |
| 9.1 | `554fd475052f…` (see `workbook-cell-meta-9.1.json` for full hash) | `vcf-9.1-planning-and-preparation-workbook.xlsx` from Broadcom techdocs |

If Broadcom re-issues either workbook with a different SHA-256, the
extraction must be re-run and this file re-signed.

## Phase 1.5 sign-off checklist (to be filled in by Phase 1 implementer)

For each cell-map entry in `WORKBOOK_CELL_MAP` (engine.js):

- [ ] **Label text match**: the entry's `label` field is a substring of the
      workbook's actual label cell content (case-insensitive).
- [ ] **Column choice**: the entry's `cell` (and any `cellByVersion`
      overrides) targets the **user-input column** (L on most sheets, D on
      Configure Management Domain). Not the sample-formula column (K or C).
- [ ] **Data type**: the target cell is not a formula cell. Stamping over
      a formula would silently destroy the workbook's wiring.
- [ ] **Data validation**: if the cell has a list-validation constraint, the
      entry carries an `allowedValues` field with the canonical enum, and
      the emitter normalizes case.
- [ ] **Merged ranges**: the target cell is either standalone or the
      top-left of its merged range. Writing to a non-top-left raises.
- [ ] **`workbookVersions` accuracy**: the version tag matches reality —
      9.0-only entries do not appear in the 9.1 cell-meta extraction with a
      label match, and vice versa.

## Sign-off record

| Date | Implementer | Workbook 9.0 SHA-256 | Workbook 9.1 SHA-256 | Cell-map commit | Notes |
|---|---|---|---|---|---|
| — | (pending Phase 1) | — | — | — | — |

## What Phase 0 extraction captured

The `workbook-cell-meta-9.0.json` and `workbook-cell-meta-9.1.json` files in
this directory contain the universe of labeled user-input cells across the
five studio-relevant sheets (Deploy Mgmt, Configure Mgmt, Deploy WLD,
Configure WLD, Deploy Cluster) plus the version-detection cells.

| Workbook | Sheets | Entries |
|---|---|---|
| 9.0 | 26 | 962 |
| 9.1 | 27 | 1008 |

Each entry carries:

- `sheet`, `cell`, `labelCell`, `labelText`
- `dataType` (openpyxl `data_type`: `s` string, `n` number, `f` formula, etc.)
- `sampleValue` (current value in the pristine workbook — usually blank for
  user-input cells; sometimes a default like "Medium")
- `sampleCell`, `sampleCellValue`, `sampleCellDataType` — the adjacent
  sample-formula column (K or C). Phase 1 ignores these for stamping but
  the data helps Phase 1.5 confirm the right column was chosen.
- `dataValidation` — array of allowed string values if the cell has a
  list-type validation, else `null`
- `mergedRange` — the merged-range string if the cell is part of one, else
  `null`

Plus per-workbook metadata: `workbookVersion`, `extractedFrom`, `sha256`,
`sheetNames`.

Phase 1 picks the ~200 entries the studio will populate from this 962/1008
universe; the rest exist for reference and to support `verify-cell-map.mjs`
sanity checks.

## Notable findings from Phase 0 extraction

The 9.1 "Deploy Management Domain" sheet was restructured more deeply
than 9.0:

- **General info** ("VCF Instance Name", "Management domain name", etc.) at
  rows 38–48 in 9.0 → moved to rows 67+ in 9.1.
- **Cluster networking** rows in the L100–L200 range had subsection inserts.
- Many cells originally pinned at specific 9.0 row addresses need
  `cellByVersion` overrides bound to discovered 9.1 row addresses. The
  Phase 0 fixtures are the authoritative source for these.

Phase 1 implementer should **diff** `workbook-cell-meta-9.0.json` against
`workbook-cell-meta-9.1.json` (matching by `labelText`) to enumerate every
row shift before authoring the cell-map constant. A helper script
(`scripts/diff-cell-meta.mjs`) would speed this up but is not required.
