# Plan 11 — Workbook Interop (Studio ↔ Official VCF 9.0 P&P Workbook)

> **Branch (when started):** `plan-11-workbook-interop`
> **Status:** 📋 Planning — not yet implemented. Captured during the Plan 10 (vCenter storage profile) session.
> **Goal:** Make the design studio's output drop-into-place with the official VMware VCF 9.0 Planning & Preparation Workbook, and (stretch) accept the workbook back as an import source.

This document captures the analysis and three implementation paths so we can return to this work later. It is the single source of truth — no follow-up reading required.

---

## 1. Why this work

The studio carries ~80 % of the values the official workbook asks for, but today's "Export Workbook CSV" emits a freeform 4-section CSV that does not line up with any official sheet. A consultant who fills out the studio still has to retype every value into the workbook by hand. We can close that loop.

The workbook is also the canonical input artifact VMware Professional Services / partners expect. If the studio's output drops in cleanly, the studio becomes a legitimate front-end to a VCF deployment — not just a sizing tool.

## 2. Current state — what `emitWorkbookRows` does today

[engine.js:1447](engine.js#L1447) `emitWorkbookRows(fleet, fleetResult)` returns 4 generic CSV sections:

| Section | Shape | Source |
|---|---|---|
| Fleet Services | 6 rows | `fleet.networkConfig.dns / ntp / syslog` |
| Network Configuration | per cluster × per network type | `cluster.networks.{mgmt,vmotion,vsan,hostTep,edgeTep}` |
| IP Address Plan | per host | `allocateClusterIps()` — hostnames since Plan 7 |
| BGP Configuration | per T0 peer | `cluster.t0Gateways[].bgpPeers[]` |

Test coverage: [tests/unit/workbook-rows-emitter.test.js](tests/unit/workbook-rows-emitter.test.js) — 8 tests, asserts headers, string-only output, and BGP inclusion.

UI: "Export Workbook CSV" button in the export bar in [vcf-design-studio-v6.jsx](vcf-design-studio-v6.jsx). Output is text/csv, opens with download-blob.

**Limitation:** Output is not addressable to specific workbook cells. A consultant must read each row and manually find the matching cell in `vcf-9.0-planning-and-preparation-workbook.xlsx`.

## 3. Field alignment study (against VCF 9.0 P&P Workbook)

Source: `vcf-9.0-planning-and-preparation-workbook.xlsx` (Broadcom techdocs). Inspected via unzip + XML parsing of `xl/worksheets/sheet*.xml` plus `xl/sharedStrings.xml`.

### Sheets that are export targets

| Sheet | Name | Purpose |
|---|---|---|
| sheet4 | Deploy Management Domain | Per-domain deployment inputs — main mgmt target |
| sheet5 | Configure Management Domain | Post-deploy config (certs, SFTP, NSX routing, AVI, stretched cluster) |
| sheet7 | Deploy Workload Domain | Per-workload-domain deployment inputs |
| sheet9 | Configure Workload Domain | Workload-domain post-deploy config |
| sheet10 | Deploy Cluster | Per-additional-cluster inputs |
| sheet14 | Static Reference Tables | Read-only lookup data (sizing). Source of truth for vCenter storage profile values in Plan 10. |
| sheet19 | Management Domain As Built | Post-deploy snapshot (could also be a STUDIO IMPORT TARGET) |
| sheet20 | Workload Domain As Built | Same as above for workload domains |

### Cells the studio CAN populate today

Roughly 80-100 cells per management domain. Representative subset from Sheet 4:

| Cell | Workbook label | Studio source |
|---|---|---|
| K38 | VCF Instance Name | `instance.name` |
| K39 | Management domain name | `domain.name` |
| K41 | Deployment model | `instance.deploymentProfile` (e.g. "ha") |
| K43 | DNS Domain name | `fleet.networkConfig.dns.primaryDomain` |
| K44 | DNS Server #1 | `dns.servers[0]` |
| K45 | DNS Server #2 | `dns.servers[1]` |
| K47 | NTP Server #1 | `ntp.servers[0]` |
| K48 | NTP Server #2 | `ntp.servers[1]` |
| K56 | Operations Appliance Size | `infraStack` find `vcfOps` |
| K57-K59 | Operations primary/replica/data-node FQDN | `resolveHostname()` if naming template set |
| K65 | Fleet Mgr FQDN | naming template |
| K78 | VCF Automation FQDN | naming template |
| K84 | Node Name Prefix | from `namingConfig.hostTemplate` |
| K90 | vCenter Appliance FQDN | naming template |
| K91 | vCenter Appliance Size | `infraStack` find `vcenter` |
| **K92** | **vCenter Appliance Storage Size** | **`entry.storageProfile` — added in Plan 10** |
| K94 | vCenter Cluster Name | `cluster.name` |
| K103 | NSX Manager Size | `infraStack` find `nsxMgr` |
| K104 | NSX Cluster FQDN | naming template |
| K105-K107 | NSX Appliance 1/2/3 FQDN | naming template |
| K116 | vSAN Architecture | `cluster.storage.policy` ("vSAN-ESA" / "vSAN-OSA") |
| K128-K143 | Host #1-#16 FQDN | `resolveHostname()` — per host |
| K148-K151 | ESX Mgmt VLAN / Gateway / CIDR / MTU | `networks.mgmt.*` |
| K154-K157 | VM Mgmt VLAN / Gateway / CIDR / MTU | `networks.mgmt.*` (same VLAN reused) |
| K159-K164 | vMotion VLAN/GW/CIDR/MTU + range start/end | `networks.vmotion.*` + pool |
| K166-K171 | vSAN VLAN/GW/CIDR/MTU + range start/end | `networks.vsan.*` + pool |
| K188-K197 | Primary VDS Name/MTU/Uplinks (1-4) | `networks.vds[0].*` |
| K199-K208 | Secondary VDS Name/MTU/Uplinks | `networks.vds[1].*` if 2-VDS profile |

Plus on Sheet 5 (Configure Management Domain):
- B92-B97 | Edge external connectivity VLAN, Gateway CIDR, Edge Cluster Name, Form Factor, Edge Node FQDNs | `cluster.t0Gateways[]` + naming template
- BGP peer rows downstream | `t0Gateways[].bgpPeers[]`

### Cells the studio CANNOT populate (and should not)

| Category | Why skipped |
|---|---|
| All passwords (root, admin, audit, SSO) | Design tool, not a secrets store |
| SFTP backup creds (Sheet 5 rows 21-28) | Secrets |
| Microsoft CA creds (Sheet 5 rows 33-50) | Secrets |
| OpenSSL/TLS cert fields (Sheet 5 rows 57-84) | Operational config, not design |
| Active Directory bind creds | Secrets |
| License keys, CEIP toggle | Out of design scope |

### Genuine gaps in the studio model (could be added later)

These the studio doesn't model today but reasonably could:
- NFS storage network (only relevant when `cluster.storage.policy` is NFS — studio is vSAN-first)
- vCenter Datastore Name (deterministic derivation possible: `${cluster.name}-ds-vsan01`)
- Per-Edge-node `vmnic` mapping (we have NIC profiles, not explicit `uplink1 → vmnic0` rows)
- VCF Automation Node IPs 1-4 + Internal Pod CIDR (K80-K85)

Out of scope for Plan 11 itself; flag as Plan 12 candidates if needed.

## 4. Three implementation paths

Documented in order of escalating effort and UX quality.

### Path A — Cell-map CSV (~150 LOC, no library)

**What it produces:** A single CSV where each row is one workbook cell.

```csv
sheet,cell,label,value
Deploy Management Domain,K38,VCF Instance Name,Acme Production
Deploy Management Domain,K39,Management domain name,sfo-m01
Deploy Management Domain,K43,DNS Domain name,acme.local
Deploy Management Domain,K44,DNS Server #1,10.50.10.4
Deploy Management Domain,K92,vCenter Appliance Storage Size,large
Deploy Management Domain,K128,Host #1 FQDN,sfo-m01-esx01.acme.local
...
```

**How the user consumes it:** A small Python or PowerShell script (~30 LOC, can ship in `scripts/stamp-workbook.py`) reads the CSV and writes the values into a copy of the official `.xlsx` using `openpyxl`:

```python
import csv, openpyxl
wb = openpyxl.load_workbook("vcf-9.0-planning-and-preparation-workbook.xlsx")
for r in csv.DictReader(open("studio-export.csv")):
    wb[r["sheet"]][r["cell"]] = r["value"]
wb.save("acme-deployment-workbook.xlsx")
```

**Pros:**
- Zero browser dependencies — pure CSV emission
- Cell-address mapping table is the single source of truth — reusable for Path B and Path C
- Trivial test: CSV row count, cell addresses match a fixture
- Round-trippable: stamp script can also DUMP a workbook to the same CSV format, which feeds the import direction

**Cons:**
- Two-step UX: download CSV, then run script
- User must trust/run an external script

**Engine changes:**
- New `emitWorkbookCellMap(fleet, fleetResult)` in [engine.js](engine.js) alongside the existing `emitWorkbookRows`. Returns an array of `{ sheet, cell, label, value }`.
- A new constant `WORKBOOK_CELL_MAP` declares the cell-address-to-value-resolver lookup table. Each entry has shape:
  ```js
  { sheet: "Deploy Management Domain", cell: "K38", label: "VCF Instance Name",
    resolve: (fleet, ctx) => ctx.instance.name }
  ```
- Per-domain expansion: for templates like `K128 = Host #1 FQDN`, the cell address pattern repeats by host index (K128-K143). The mapping table needs a "loop" form for repeated rows.

**UI changes:**
- New "Export Workbook Cell Map (CSV)" button alongside the existing one. Keep the old freeform CSV — useful for human-readable reference. Add a small "How to use this" link to a help modal explaining the stamp script.

**Tests:**
- New `tests/unit/workbook-cell-map.test.js`
- Validates: mapping table is well-formed, every entry has a unique `sheet+cell`, `resolve` returns a string or null, fixtures produce expected cell counts.
- Round-trip: serialize fleet → CSV → re-parse via a `parseWorkbookCellMap` helper → assert recovered fleet fields equal original.

**Stretch — `scripts/stamp-workbook.py`:** small Python helper (committed, not bundled) that stamps a downloaded copy of the official workbook. Document in README.

### Path B — Workbook-shaped CSV (~300 LOC, no library)

**What it produces:** A multi-section CSV mirroring the workbook's visual layout. Each section's header line is the workbook sheet name + subsection title; rows beneath line up one-per-cell for easy manual paste.

```csv
## Sheet: Deploy Management Domain — General Information
Configuration,Sample,Your Value
VCF Instance Name,San Francisco,Acme Production
Management domain name,sfo-m01,sfo-m01
DNS Domain name,rainpole.io,acme.local

## Sheet: Deploy Management Domain — vCenter
Configuration,Sample,Your Value
Appliance FQDN,sfo-m01-vc01.sfo.rainpole.io,sfo-m01-vc01.acme.local
Appliance Size,Small,Medium
Appliance Storage Size,Default,large
```

**How the user consumes it:** Open both the CSV and the workbook side-by-side; paste each section's "Your Value" column into the workbook's column L (or D, depending on section). No script needed; ~5 minutes per domain.

**Pros:**
- Self-documenting (label + sample + value on the same row, matching workbook visual)
- No tooling — Excel can open the CSV directly
- Still uses the cell-map table from Path A internally

**Cons:**
- Manual paste step — error-prone for large deployments
- Doesn't help with round-trip import

**Recommended only as an intermediate stop** if Path A's "run a script" UX is too friction-y for the consultant audience. Otherwise skip to Path C.

### Path C — Native .xlsx download (~500 LOC + library, best UX)

**What it produces:** A single-click download of a populated copy of the official workbook.

**Library options:**

| Lib | Browser size | Reads .xlsx | Writes .xlsx | Notes |
|---|---|---|---|---|
| SheetJS (xlsx) | ~620 KB minified | ✅ | ✅ | Most popular, free core |
| ExcelJS | ~900 KB | ✅ | ✅ | Better styling support, heavier |
| Hand-rolled OOXML | 0 KB external | ❌ (would need writing) | ✅ (lots of code) | Plausible but multi-week |

**Build:** `scripts/build-html.mjs` already inlines [engine.js](engine.js) into the HTML. SheetJS would similarly be inlined as a `<script>` block; bundled file grows by ~620 KB minified or ~150 KB gzipped (Vite/Rollup default).

**Workflow:**
1. The studio ships with a pristine copy of `vcf-9.0-planning-and-preparation-workbook.xlsx` either:
   - Bundled as a base64 string in the HTML (~1.2 MB raw → ~1.6 MB base64 — borderline)
   - Or fetched at click-time from a CDN / local path
2. On "Export Workbook," load the pristine workbook in-memory via SheetJS, stamp every cell from the cell-map table, hand the result back as a Blob, trigger download.

**Pros:**
- One-click UX matching expectations for a design tool
- No manual paste, no external scripts
- Output is a real `.xlsx` that opens in Excel, Google Sheets, LibreOffice

**Cons:**
- ~620 KB bundle increase
- Workbook file shipping — license/redistribution question (the P&P workbook is a Broadcom techdocs public asset; need to confirm OK to bundle vs. requiring user to drop their own copy in a known path)
- Excel can be picky about file integrity — SheetJS sometimes drops styles/named ranges when re-writing; needs verification against the actual workbook before committing
- Workbook version drift: if Broadcom ships a 9.0.x update with new cells, the cell-map table needs to update

**Why this might still be right:** Consultant audiences value zero-friction handoff. A button that produces a Broadcom-formatted workbook is the deliverable they actually want.

## 5. Bidirectional import — Workbook → Studio

Independent of which path above ships first, the cell-map table from Section 4 is the foundation for import. Once you have a `WORKBOOK_CELL_MAP` array with `{ sheet, cell, resolve }`, you can:

1. Parse a workbook (CSV cell-map format from Path A, or .xlsx via SheetJS for Path C)
2. For each known cell, look up the value
3. Apply to a draft fleet object using `apply(fleet, ctx, value)` — the inverse of `resolve`

### Feasibility

**More feasible than the initial agent audit suggested.** Blockers from that audit reconsidered:

| Blocker (claimed) | Reality |
|---|---|
| "No unique IDs in workbook" | True, but per-cluster cells are deterministic by sheet (Sheet 4 = mgmt domain, Sheet 7 = wld domain #1, Sheet 10 = additional cluster). The studio uses generated IDs internally — import creates them. |
| "Free-form text vs structured objects" | False for the cells the studio cares about. VLAN cells are integers, CIDR cells are CIDR, FQDN cells are FQDN. Parsing is straightforward. |
| "No secrets storage" | Correct — and that's by design. Passwords are simply skipped on import. |
| "Conflict resolution" | Real concern but solvable: show a 3-way diff (current studio state vs. imported workbook vs. proposed merged state) before applying. |

### Open questions for import

1. **One workbook = one VCF instance, or one fleet?** The workbook's Sheet 4 has slots for ONE mgmt domain; Sheets 7/9/10 add workload domains and clusters. So one workbook covers one VCF instance. Multi-instance fleets would need multiple workbooks (or a future "Federated Fleet" sheet — doesn't exist today).
2. **Greenfield import vs merge?** Greenfield: workbook becomes the entire studio state. Merge: workbook updates an existing studio fleet. Greenfield is simpler — start there.
3. **Round-trip safety:** Studio → workbook → studio should be idempotent for all cells the studio populates. The cell-map's `resolve` and `apply` must be inverses. Add a property-based test.

### Estimated effort

- Import (greenfield, Path A CSV input): ~250 LOC + reuse of cell-map table → 2-3 days
- Import (.xlsx input via SheetJS): ~150 additional LOC + library work → 1-2 more days
- Conflict-resolution / merge UI: 1-2 weeks. Defer to Plan 12.

## 6. Recommended sequencing

**Phase 1 — Path A only.** Smallest, highest-leverage step. Builds the cell-map table that everything downstream uses.

- New `WORKBOOK_CELL_MAP` constant in [engine.js](engine.js)
- New `emitWorkbookCellMap(fleet, fleetResult)` function
- New UI button next to the existing CSV export
- New tests, including a fixture-based snapshot of the emitted cell-map for the default HA fleet
- `scripts/stamp-workbook.py` helper, documented in README
- Keep the existing 4-section CSV — it's still useful for human reference

**Phase 2 — Greenfield import via CSV cell-map.** Reuse the table from Phase 1 by adding an `apply` function next to `resolve`. Add a "Import Workbook CSV" button that builds a fresh fleet from a cell-map file.

**Phase 3 — Path C native .xlsx (export + import).** Only after Phase 1 has been used in anger for a few weeks. Bundle SheetJS, populate a pristine workbook, support drag-and-drop .xlsx in. Validates the cell-map by round-tripping.

**Phase 4 (optional) — Conflict-resolution merge UI.** Needed if real users start importing partially-edited workbooks back into populated studio states.

## 7. Decisions to make before starting

| # | Decision | Default proposed | Notes |
|---|---|---|---|
| 1 | Skip Path B entirely? | Yes | Path A's stamp script is small enough that Path B's manual-paste workflow doesn't add value. |
| 2 | Ship Phase 1 + Phase 2 together, or in separate PRs? | Separate | Phase 1 standalone is shippable; Phase 2 adds review burden. |
| 3 | Where does the pristine workbook live? (Phase 3) | Don't bundle — user supplies it | License is unclear; pristine workbook is a Broadcom asset. User downloads from techdocs, drops into a known UI slot. |
| 4 | Should `stamp-workbook.py` go in this repo? | Yes | Small helper, single file, documents the format. |
| 5 | Should the cell-map table handle workbook version drift? | Yes — add a `workbookVersion: "9.0"` field on every entry | Future 9.1 cells get added with a version guard. |
| 6 | Do we model FQDN explicitly per appliance, or always derive from hostname + DNS domain? | Derive | FQDN = `${resolveHostname(...)}.${dns.primaryDomain}`. Avoids a new schema field. |
| 7 | What about Sheet 19/20 ("As Built") — populate them as output? | Phase 4 | These describe post-deploy state. Studio knows the intended state, so could emit them. Defer. |

## 8. Risks

1. **Cell address drift across workbook minor versions.** Broadcom may renumber rows in a 9.0.x update. Mitigation: pin a `workbookVersion` constant; print a clear error when stamping a workbook of an unexpected version.
2. **Round-trip lossiness.** Some studio-internal fields (`cluster.id`, `cluster.key`, host order in `hostOverrides`) have no workbook representation. On round-trip, IDs get regenerated — downstream consumers tied to studio IDs lose continuity. Mitigation: documented behavior, not a defect.
3. **Naming-template-dependent FQDNs.** If the user hasn't configured a naming template (Plan 7), FQDN cells in the export are blank. That's intended, but it surprises users. Mitigation: pre-flight check on export — if `namingConfig.hostTemplate` is empty AND the user is exporting a workbook, surface a warning recommending they set a template first.
4. **Secrets temptation.** Once the export covers 90 % of cells, users will ask "why not passwords too?" Hold firm: design tool ≠ secrets store. Document explicitly in the export modal.
5. **Workbook copyright/redistribution.** If Phase 3 bundles the pristine workbook, we'd need to confirm Broadcom's redistribution terms. Safer fallback: user supplies their own .xlsx; studio just stamps it.

## 9. Files that would change (Phase 1 only)

| File | Change | LOC est |
|---|---|---|
| [engine.js](engine.js) | Add `WORKBOOK_CELL_MAP` constant + `emitWorkbookCellMap` function | ~200 |
| [engine.js](engine.js) | Export new symbols on `VcfEngine` | ~3 |
| [vcf-design-studio-v6.jsx](vcf-design-studio-v6.jsx) | Destructure new symbols; add "Export Workbook Cell Map" button next to existing CSV export | ~30 |
| [vcf-design-studio-v6.jsx](vcf-design-studio-v6.jsx) | Help modal explaining the stamp-script workflow | ~50 |
| `scripts/stamp-workbook.py` | NEW — small helper that ingests cell-map CSV and writes a populated copy of the official workbook via openpyxl | ~40 |
| `tests/unit/workbook-cell-map.test.js` | NEW — fixture-based tests of the cell-map emitter | ~150 |
| `tests/unit/engine-smoke.test.js` | Add new symbol(s) to `EXPECTED_SYMBOLS` | ~2 |
| [README.md](README.md) | New "Workbook Cell-Map Export" section | ~40 |

**Total Phase 1 estimate:** ~500 LOC, one PR.

## 10. Resuming this work later

```bash
git checkout main
git pull
git checkout -b plan-11-workbook-interop
cat PLAN-11-WORKBOOK-INTEROP.md  # this file
```

Start with Section 6 Phase 1. The cell-map table in Section 3 is the prework — flesh it out into a real JS constant in `engine.js`, with one entry per workbook cell the studio can populate. Everything else cascades from that.

### Quick-start: minimum viable cell-map shape

```js
const WORKBOOK_CELL_MAP = [
  // Per-instance / per-fleet scope
  { sheet: "Deploy Management Domain", cell: "K38",
    label: "VCF Instance Name",
    scope: "instance",
    resolve: (fleet, ctx) => ctx.instance?.name || "" },

  { sheet: "Deploy Management Domain", cell: "K39",
    label: "Management domain name",
    scope: "mgmt-domain",
    resolve: (fleet, ctx) => ctx.domain?.name || "" },

  // Per-host expansion (K128-K143 = Host #1-#16 FQDN)
  { sheet: "Deploy Management Domain", cellPattern: "K{128+i}",
    label: "Host #{i+1} FQDN",
    scope: "mgmt-cluster-host",
    expandsTo: 16,
    resolve: (fleet, ctx, i) => {
      const hn = resolveHostname(fleet, ctx.instance, ctx.domain, ctx.cluster, i);
      const dn = fleet.networkConfig?.dns?.primaryDomain;
      return hn && dn ? `${hn}.${dn}` : (hn || "");
    } },
  // ... ~80 more entries
];
```

The `scope` field tells the emitter which iteration context to bind: `instance` runs once per VCF instance, `mgmt-domain` once per mgmt domain found, `mgmt-cluster-host` once per host of the mgmt cluster, etc. The emitter walks the fleet, builds the right context per scope, and calls `resolve(fleet, ctx, i?)`.

For import, add `apply(fleet, ctx, value)` alongside `resolve` — the inverse. Same scoping rules.

---

## Appendix A — Reproduce the workbook field extraction

```bash
curl -L -o vcf-9.0-pnp.xlsx \
  "https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/assets/vmware-cis/vcf/vcf-9.0-planning-and-preparation-workbook.xlsx"
mkdir vcf-pnp && cd vcf-pnp && unzip -o ../vcf-9.0-pnp.xlsx
# Then walk xl/worksheets/sheet*.xml with the Python snippet in Section 4 of
# the original investigation in PLAN-11-WORKBOOK-INTEROP commit history.
```

## Appendix B — Sheet → studio-scope mapping

| Sheet | Iterates over | Repeats per |
|---|---|---|
| Sheet 4 "Deploy Management Domain" | one mgmt domain | per instance |
| Sheet 5 "Configure Management Domain" | one mgmt domain (post-deploy) | per instance |
| Sheet 7 "Deploy Workload Domain" | one workload domain | per workload domain |
| Sheet 9 "Configure Workload Domain" | one workload domain (post-deploy) | per workload domain |
| Sheet 10 "Deploy Cluster" | one additional cluster | per cluster beyond the first in each domain |

A multi-instance / multi-WLD fleet maps to MULTIPLE workbooks. One workbook = one VCF instance.
