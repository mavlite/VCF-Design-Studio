# Plan 11 — Workbook Interop (Studio ↔ Official VCF 9.0 & 9.1 P&P Workbooks)

> **Branch (when started):** `plan-11-workbook-interop`
> **Status:** ✅ Plan 11 functionally complete (2026-05-21). Phase 1a (CSV cell-map export), Phase 1b (native .xlsx export via SheetJS), Phase 2 (greenfield workbook → studio import), and the broaden-apply pass are all shipped. Every cell-map entry now either has a working `apply` function (21 entries — DNS/NTP servers, instance/domain identity, deployment model, vCenter sizing + cluster name, NSX Manager sizing, vSAN architecture, ESX/vMotion/vSAN VLAN IDs, VCFMS pool start, per-host FQDN expansion stripping DNS suffix to populate `hostOverrides[i].hostname`, workload domain name, NSX Edge Cluster Name, additional cluster name) or is explicitly tagged `emitOnly: true` (6 entries — vCenter Appliance FQDN, the four naming-template-derived VCFMS/Automation FQDNs, VCFMS pool end). The importer sorts rows by scope priority (per-fleet → instance → mgmt-domain → mgmt-cluster → host → workload-*) before applying so dependent values resolve in order, and pre-allocates additional-cluster skeletons one-per-row so multi-cluster workbooks round-trip correctly. The previously vague "skipped / no apply function" diagnostic now distinguishes intentional emit-only entries from genuinely-missing applies. Total coverage gate green at 98.5 stmts / 76.67 branches / 100 funcs / 98.5 lines, 1273 unit tests, 17/17 E2E. **Remaining work**: Phase 1.5 human Excel walkthrough sign-off (user-driven; cell-meta fixtures + verifier are clean). Plan 13 (workbook password generation) is queued separately.
> **Goal:** Make the design studio's output drop-into-place with the **official VMware VCF Planning & Preparation Workbook for either VCF 9.0 or VCF 9.1** (selected by `fleet.vcfVersion`), and (stretch) accept either workbook back as an import source — with `vcfVersion` inferred from the workbook's content.

This document captures the analysis and three implementation paths so we can return to this work later. It is the single source of truth — no follow-up reading required. Cross-references: [VCF-9.1-DELTA.md](VCF-9.1-DELTA.md) (changes between 9.0 and 9.1 workbooks), [README.md](README.md) (studio v9 architecture).

---

## 1. Why this work

The studio carries ~80 % of the values the official workbook asks for, but today's "Export Workbook CSV" emits a freeform 4-section CSV that does not line up with any official sheet. A consultant who fills out the studio still has to retype every value into the workbook by hand. We can close that loop.

The workbook is also the canonical input artifact VMware Professional Services / partners expect. If the studio's output drops in cleanly, the studio becomes a legitimate front-end to a VCF deployment — not just a sizing tool.

**Why dual-version matters now.** With Plan 12 (v9 rebrand) the studio targets both VCF 9.0 and VCF 9.1 from one codebase. A fleet's `vcfVersion` field tells us which workbook to target on export, and on import we must detect which workbook the user is feeding us (the two share most cells but diverge in vCenter storage values, add VCFMS-specific cells in 9.1, and introduce new sheets like "Active Directory Inputs"). The interop layer is the natural place to consolidate that version-aware mapping.

## 2. Current state — what `emitWorkbookRows` does today

[engine.js:1605](engine.js#L1605) `emitWorkbookRows(fleet, fleetResult)` returns 4 generic CSV sections:

| Section | Shape | Source |
|---|---|---|
| Fleet Services | 6 rows | `fleet.networkConfig.dns / ntp / syslog` |
| Network Configuration | per cluster × per network type | `cluster.networks.{mgmt,vmotion,vsan,hostTep,edgeTep}` |
| IP Address Plan | per host | `allocateClusterIps()` — hostnames since Plan 7 |
| BGP Configuration | per T0 peer | `cluster.t0Gateways[].bgpPeers[]` |

Test coverage: [tests/unit/workbook-rows-emitter.test.js](tests/unit/workbook-rows-emitter.test.js) — 8 tests, asserts headers, string-only output, and BGP inclusion.

UI: "Export Workbook CSV" button in the export bar in [vcf-design-studio-v9.jsx](vcf-design-studio-v9.jsx). Output is text/csv, opens with download-blob.

**Limitation 1: Not cell-addressable.** Output is not aligned to specific workbook cells. A consultant must read each row and manually find the matching cell in the official `.xlsx`.

**Limitation 2: Not version-aware.** The function ignores `fleet.vcfVersion`. The studio's underlying sizing engine respects the version (vCenter storage values, VCFMS presence), but the workbook emitter doesn't surface that — it produces the same CSV shape regardless of whether the fleet targets 9.0 or 9.1. Plan 11 fixes both limitations together.

## 3. Field alignment study (against VCF 9.0 & 9.1 P&P Workbooks)

Sources:
- `vcf-9.0-planning-and-preparation-workbook.xlsx` (Broadcom techdocs)
- `vcf-9.1-planning-and-preparation-workbook.xlsx` (Broadcom techdocs)

Both were inspected via unzip + XML parsing of `xl/worksheets/sheet*.xml` plus `xl/sharedStrings.xml`, with Round 1 review cross-checking against the actual workbook contents. The 9.1 deltas are summarized in [VCF-9.1-DELTA.md](VCF-9.1-DELTA.md); this section captures the *cell-level* differences specifically.

### Workbook column convention — **CRITICAL**

The Broadcom workbooks consistently use a **three-column input layout per sheet**:

| Column | Role |
|---|---|
| `J` (or `B` on some sheets) | **Label** — the question text ("VCF Instance Name", "DNS Domain name") |
| `K` (or `C`) | **Sample** — a *formula-driven* example value (`CONCATENATE(prefix_portable_component,"-auto")`) referencing defined names |
| `L` (or `D`) | **Your Value** — the empty user-input cell |

**The stamp script writes to the L (or D) column — never K**. Writing to K silently overwrites Broadcom's sample formulas, breaks named-range references, and produces a workbook that no longer auto-updates its preview values when other cells change.

Plan 11 cell-map entries use `L<row>` or `D<row>` accordingly. Plan revisions during Round 1 corrected an earlier draft that used K-column cells throughout.

### Sheets that are export targets

| Sheet | 9.0 sheet # | 9.1 sheet # | Notes |
|---|---|---|---|
| Deploy Management Domain | 4 | **5** | 9.1 inserted Static Reference Tables ahead of it, so all subsequent sheets shifted +1 |
| Configure Management Domain | 5 | **6** | |
| Deploy Workload Domain | 7 | **8** | |
| Configure Workload Domain | 9 | 9 | Same position (some inserts were absorbed) |
| Deploy Cluster | 10 | 10 | Same position |
| Static Reference Tables | 14 | **4** | Promoted in 9.1; read-only sizing lookup |
| Management Domain As Built | 19 | 19 | Post-deploy snapshot (also a STUDIO IMPORT TARGET) |
| Workload Domain As Built | 20 | 20 | Same as above for workload domains |

Sheet **positions** shift in 9.1, but addressing by **sheet name** (via `wb["Deploy Management Domain"]`) is stable — the stamp script must use the name, not the index.

### Shared sheets (present in BOTH 9.0 and 9.1)

The first round of agent review incorrectly flagged several sheets as "new in 9.1." They are not — they exist in 9.0 too, though some expanded in 9.1.

| Sheet | 9.0 | 9.1 | Scope decision |
|---|---|---|---|
| Active Directory Inputs | sheet26 | sheet27 | Shared. **Non-standard column layout** — B=label, C=Domain (Parent/Child), D=reference username/group, E=user-input username/group, F=reference password, **G=user-input password**. The studio MUST skip columns F and G (passwords) on emit. Out of scope for Plan 11 Phase 1; deferred to Phase 5 unless the studio gains an `adConfig` model. |
| Private AI Ready Infrastructure | sheet23 | sheet24 | Shared. Solution module; out of scope. |
| Cross Cloud Mobility (HCX) | sheet25 | sheet26 | Shared. Solution module; out of scope. |
| Cloud-Based Ransomware Recovery | sheet24 | sheet25 | Shared but cell layout expanded in 9.1. Out of scope. |

### Genuinely new sheets in 9.1

| Sheet | 9.1 sheet # | Notes |
|---|---|---|
| Cyber Recovery | sheet18 | New in 9.1. Out of scope for Plan 11 Phase 1; flag as Phase 5 candidate. |

### Cells the studio CAN populate today

Phase 1.5 verification must extract the authoritative cell map per workbook version. Representative subset from Sheet "Deploy Management Domain" (cells below use the **L column for user values**, with the row numbers corrected for VCF 9.0; per-row shifts for 9.1 are flagged in the next subsection):

| Cell (9.0) | Workbook label | Studio source |
|---|---|---|
| L38 | VCF Instance Name | `instance.name` |
| L39 | Management domain name | `domain.name` |
| L41 | Deployment model | `instance.deploymentProfile` (e.g. "ha") |
| L43 | DNS Domain name | `fleet.networkConfig.dns.primaryDomain` |
| L44 | DNS Server #1 | `dns.servers[0]` |
| L45 | DNS Server #2 | `dns.servers[1]` |
| L47 | NTP Server #1 | `ntp.servers[0]` |
| L48 | NTP Server #2 | `ntp.servers[1]` |
| L56 | Operations Appliance Size | `infraStack` find `vcfOps` |
| L57-L59 | Operations primary/replica/data-node FQDN | `resolveHostname()` if naming template set |
| L65 | Fleet Mgr FQDN | naming template |
| L78 | VCF Automation FQDN | naming template |
| L84 | Node Name Prefix | from `namingConfig.hostTemplate` *(moved to L412 in 9.1 — see "Cell shifts" subsection)* |
| L90 | vCenter Appliance FQDN | naming template |
| L91 | vCenter Appliance Size | `infraStack` find `vcenter` |
| **L92** | **vCenter Appliance Storage Size** *(moved to L326 in 9.1's API-only sub-section)* | **`entry.storageProfile` — added in Plan 10** |
| L94 | vCenter Cluster Name | `cluster.name` |
| L103 | NSX Manager Size | `infraStack` find `nsxMgr` |
| L104 | NSX Cluster FQDN | naming template |
| L105-L107 | NSX Appliance 1/2/3 FQDN | naming template |
| L116 | vSAN Architecture *(9.0 only; renamed in 9.1)* | `cluster.storage.policy` ("vSAN-ESA" / "vSAN-OSA") |
| L128-L143 | Host #1-#16 FQDN | `resolveHostname()` — per host |
| L148-L151 | ESX Mgmt VLAN / Gateway / CIDR / MTU | `networks.mgmt.*` |
| L154-L157 | VM Mgmt VLAN / Gateway / CIDR / MTU | `networks.mgmt.*` (same VLAN reused) |
| L159-L164 | vMotion VLAN/GW/CIDR/MTU + range start/end | `networks.vmotion.*` + pool |
| L166-L171 | vSAN VLAN/GW/CIDR/MTU + range start/end | `networks.vsan.*` + pool |
| L188-L197 | Primary VDS Name/MTU/Uplinks (1-4) | `networks.vds[0].*` |
| L199-L208 | Secondary VDS Name/MTU/Uplinks | `networks.vds[1].*` if 2-VDS profile |

Plus on Sheet "Configure Management Domain" (Sheet 5 in 9.0, Sheet 6 in 9.1) — user value column is **D**, not B (B is the label, C is the sample/reference):

| 9.0 cell | Workbook label | Studio source | Design vs operational? |
|---|---|---|---|
| D92 | NSX Edge Uplink VLAN ID | `cluster.t0Gateways[].uplinkVlan` | design |
| D93 | NSX Edge Uplink Gateway CIDR (IPv4) | `cluster.t0Gateways[].uplinkGateway` | design |
| D95 | Edge Cluster Name | `cluster.t0Gateways[].clusterName` (or derived from cluster.name) | design |
| D96 | Tunnel Endpoint MTU | `cluster.networks.edgeTep.mtu` | design |
| D97 | Edge Form Factor (Small/Medium/Large/XL) | `infraStack` find `nsxEdge` | design |
| D99+ | Edge Node FQDN rows | naming template | design |
| (BGP) D~110+ | BGP peer rows | `t0Gateways[].bgpPeers[]` | design |
| ~D21–D28 | SFTP backup creds | — | **operational — SKIP** |
| ~D33–D50 | Microsoft CA / Intermediate CA fields | — | **operational — SKIP** |
| ~D57–D84 | OpenSSL TLS cert fields | — | **operational — SKIP** |

In 9.1 these row numbers shift due to inserted subsections; Phase 1.5 must re-extract. The categorization stays — anything labeled cert/SFTP/CA/password is operational and skipped; anything labeled with a design-time noun (Edge, VLAN, Cluster, MTU, BGP, FQDN, IP) is design-time and emitted.

### 9.1-only VCFMS cells (Sheet "Deploy Management Domain", Sheet 5 in 9.1)

VCFMS (VCF Management Service) introduces new cells in the 9.1 workbook for the Kubernetes-based fleet control plane. Cell addresses below were extracted from the actual 9.1 workbook during Round 2 review (Round 1 placed them on the wrong sheet).

- VCFMS cells live on **"Deploy Management Domain"** (sheet 5 in 9.1), in the same sheet as the rest of the mgmt-domain inputs — NOT on the Configure sheet.
- There is **no "VCFMS Control Node size" / "Worker Node size" input cell** in either workbook — sizing is reference-only on Sheet 4 / 14 (B271–B306). The studio supplies the size in `infraStack`; the workbook export DOES NOT have a target cell for it. The studio's size selection is captured in JSON export but is **not** written into the workbook.
- There are **no per-node VCFMS FQDN cells**. Only cluster-level FQDNs exist.

| Cell (9.1) | Workbook label | Studio source |
|---|---|---|
| L117 | VCFMS Node IPv4 IP Range — From | `cluster.networks.mgmt.pool.start` — the K8s node block |
| L118 | VCFMS Node IPv4 IP Range — To | derived: start + worker pool size + control pool size + any user-customized `vcfmsWorker.instances` beyond default |
| L119 | VCFMS Node IPv6 IP Range — From | optional dual-stack |
| L120 | VCFMS Node IPv6 IP Range — To | optional dual-stack |
| L168 | Instance Components FQDN | naming template + DNS domain — on the initial instance's mgmt domain |
| L169 | Identity Broker FQDN | naming template |
| L170 | VCF services runtime FQDN | naming template + DNS domain |
| L176 | VCF Automation services runtime FQDN | naming template + DNS domain |

**Things the plan previously claimed that do not exist or were on the wrong sheet:**
- VCFMS Control Node size / Worker Node size as user-input cells → no such input; sizing is reference-only on Static Reference Tables (Sheet 4 in 9.1 / Sheet 14 in 9.0), cells B271–B306.
- Kubernetes Pod CIDR as discrete input cell → does not exist as named user input. Internal value (`198.18.0.0/15`) is documented in [VCF-9.1-DELTA.md](VCF-9.1-DELTA.md) only.
- Per-node VCFMS FQDNs → cluster-level only; do not loop per worker / per control node.

### Cell shifts and relocations from 9.0 → 9.1 (Sheet "Deploy Management Domain")

The 9.1 Deploy Mgmt sheet restructured several sections. Some rows moved within the sheet (some to API-only customization sub-sections lower in the same sheet); the cell-map needs `cellByVersion` overrides for these.

| Label | 9.0 cell | 9.1 cell | Notes |
|---|---|---|---|
| Node Name Prefix | L84 | **L412** | Relocated to API-only customization section in 9.1 (not removed) |
| vCenter Appliance Storage Size | L92 | **L326** | Moved into "API-only customization" section of vCenter (J319–J328); still populatable, but no longer in the main vCenter rows |
| vSAN Architecture | L116 (label "vSAN Architecture") | L58 (label "Storage Option") | Renamed; value enum may include NFS / VMFS options in 9.1 alongside vSAN-ESA / vSAN-OSA |
| Host #1 FQDN | L128 | L82 | Host block moved earlier in the sheet |
| Host #2 – #16 FQDN | L129 – L143 | L83 – L97 | **16-row contiguous block** (host #1 through host #16), same expansion semantics |

The cell-map's `cellByVersion: { "9.0": "L84", "9.1": "L412" }` handles relocations; same pattern for L92 → L326 and L128 → L82.

### Cells that diverge between 9.0 and 9.1 (semantics only)

| Cell | 9.0 meaning | 9.1 meaning | Discrimination strategy |
|---|---|---|---|
| Static Reference Tables → vCenter Disk → MediumDefault | 9.0 sheet 14 cell **C52 = 908** | 9.1 sheet 4 cell **C55 = 858** (sheet promoted to position 4; row shifted +3) | Studio does not emit static reference tables (read-only by definition) — but the **import-side version detector (Section 5 step 4)** reads this exact cell to corroborate the `Sheet2!J16` primary version detection. |
| Auto-RAID FTT selection | Manual policy selection at known cell | Automated by host count (3-5 → FTT=1, 6+ → FTT=2) | **Phase 1.5 default position: emit anyway** unless extraction reveals the cell is gone in 9.1. If 9.1 retains the cell, the deploy-time auto-RAID overrides whatever the workbook says — no conflict; documented as an export-time informational comment. If 9.1 removed the cell, drop the entry from `workbookVersions: ["9.1"]`. |

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
- VCF Automation Node IPs 1-4 + Internal Pod CIDR (9.0 cells around L80–L85; restructured in 9.1)
- **Active Directory bind config** — the studio has `ssoMode` but no AD bind fields. Could add a fleet-level `fleet.adConfig: { domain, baseDn, ou, serviceAccount }` field that's **stored but never displays passwords**. The AD sheet has bind-password columns (F/G) the studio MUST skip; the rest is design-time metadata (parent/child domain FQDN/NetBIOS, user/group OUs, multiple service-account rows like `svc-vsphere-ad`, `svc-logs-ad`, `svc-ops-vcf`). Existing in BOTH 9.0 and 9.1 — not a 9.1-only sheet.
- **VCFMS Kubernetes pod CIDR override** — the studio could expose this as a settings field. There is **no discrete input cell** for it in either workbook; the value is implicit. Studio defaults to `198.18.0.0/15` (documented in [VCF-9.1-DELTA.md](VCF-9.1-DELTA.md)).

Out of scope for Plan 11 itself; flag as future-plan candidates if needed.

### Cells that would feed import-side `vcfVersion` inference

When importing a workbook, the studio needs to detect which version was used. Strategies (in order of preference):

1. **Workbook version cell — `Sheet2!J16`** carries the literal version string (`9.0.2.0` or `9.1.0.0`). Single deterministic cell, present in both workbooks. **This is the canonical detection cell** — start here and only fall through to other heuristics if the cell is missing or unparseable. Corroborating cells in 9.1: `Sheet7!C85`, `Sheet7!C108`, `Sheet7!C123`, `Sheet7!C163`, `Sheet7!C178` all contain the literal `9.1.0.0`. (`docProps/core.xml` `dc:title` is empty in both versions — do not rely on it.)
2. **Sheet name set**: 9.1 adds `"Cyber Recovery"`; if that sheet name is present, it's 9.1. (Earlier draft of this plan incorrectly listed AD Inputs / Private AI / HCX / Ransomware Recovery as 9.1-only — they are shared.)
3. **VCFMS cell presence**: If Sheet "Deploy Management Domain" has populated cells at L168–L170 / L117–L120 with VCFMS-shaped values, it's 9.1.
4. **vCenter Static Reference values**: Sheet "Static Reference Tables" cell `C52` in 9.0 / `C55` in 9.1, under label "MediumDefault" — if 858, it's 9.1; if 908, it's 9.0. Cross-check with [VCF-9.1-DELTA.md](VCF-9.1-DELTA.md). Least reliable; depends on user not having edited the Static Reference Tables sheet.
5. **Fallback**: prompt the user via a dropdown. Never silently default; we'd rather have explicit user confirmation than wrong sizing.

## 4. Three implementation paths

Documented in order of escalating effort and UX quality.

### Path A — Cell-map CSV (~200 LOC, no library)

**What it produces:** A single CSV where each row is one workbook cell. **Includes the target workbook version** so the stamp script picks the right `.xlsx` and so re-import can verify version match.

```csv
workbookVersion,sheet,cell,label,value
9.1,Deploy Management Domain,L38,VCF Instance Name,Acme Production
9.1,Deploy Management Domain,L39,Management domain name,sfo-m01
9.1,Deploy Management Domain,L43,DNS Domain name,acme.local
9.1,Deploy Management Domain,L44,DNS Server #1,10.50.10.4
9.1,Deploy Management Domain,L82,Host #1 FQDN,sfo-m01-esx01.acme.local
9.1,Deploy Management Domain,L117,VCFMS Node IPv4 IP Range From,10.50.10.31
9.1,Deploy Management Domain,L118,VCFMS Node IPv4 IP Range To,10.50.10.45
9.1,Deploy Management Domain,L168,Instance Components FQDN,sfo-ic01.acme.local
9.1,Deploy Management Domain,L326,vCenter Appliance Storage Size,large
9.1,Deploy Management Domain,L412,Node Name Prefix,sfo-m01-auto
...
```

A header row carrying `# workbookVersion: 9.1` is also acceptable; the per-row column is simpler to consume from `openpyxl`.

**How the user consumes it:** A Python script (~150 LOC; ship in `scripts/stamp-workbook.py`) reads the CSV, picks the right pristine workbook by `workbookVersion`, and writes the values via `openpyxl`. Naïve assignment is **destructive** — the script must defend against the openpyxl realities documented below.

```python
# Simplified outline; production script must add the safeguards listed below.
import csv, openpyxl, sys
ROWS = list(csv.DictReader(open(sys.argv[1])))
wb_version = ROWS[0]["workbookVersion"]
wb_file = {
    "9.0": "vcf-9.0-planning-and-preparation-workbook.xlsx",
    "9.1": "vcf-9.1-planning-and-preparation-workbook.xlsx",
}[wb_version]
wb = openpyxl.load_workbook(wb_file, data_only=False)  # keep_vba only if macros present
for r in ROWS:
    assert r["workbookVersion"] == wb_version, "Mixed-version CSV not supported"
    if r["sheet"] not in wb.sheetnames:
        sys.exit(f"Sheet '{r['sheet']}' not in workbook. Available: {wb.sheetnames}")
    ws = wb[r["sheet"]]
    cell = ws[r["cell"]]
    # See "openpyxl brittleness" below for the must-have safeguards we glossed over here.
    cell.value = r["value"]
wb.save(sys.argv[2])
```

**openpyxl brittleness — must-haves before this script is safe to ship:**

1. **Formula cells.** Many `K`-column and some `L`-column cells contain formulas referencing defined names (`mgmt_dpg_reuse_result`, `prefix_mgmt_az1_cidr`, `this_instance`, etc.). Writing a string to those cells *destroys the formula without warning*. The cell-map MUST target only the user-value column (`L` or `D`) and the verify-cell-map script MUST flag any planned write to a cell whose `cell.data_type == "f"` (formula) as an error during CI.
2. **Data validation.** Sheet `xl/worksheets/sheetN.xml` carries `<dataValidations>` blocks for cells with controlled value lists (e.g. "vSAN-ESA"/"vSAN-OSA", "Small/Medium/Large/X-Large"). Writing arbitrary strings — including case variants like "medium" vs "Medium" — produces a workbook that Excel flags as having validation errors on open. The cell-map entry must carry an `allowedValues` field and the emitter must normalize case to match.
3. **Merged ranges.** Some workbook rows are visually merged (headers, instruction blocks). Writing to a non-top-left cell of a merged range raises `MergedCell.value setter` errors in openpyxl. The script must detect merged ranges via `ws.merged_cells.ranges` and either skip or redirect to the top-left.
4. **Defined names.** The workbook uses extensive named ranges (`prefix_portable_component`, `mgmt_domain_chosen`, `this_instance`, `flt_auto_node_pool_start_ip`, …) that K-column formulas reference. The script does not touch named-range definitions — but Phase 1.5 verification must ensure cell-map targets do not include named-range cells (they're meta-data, not inputs).
5. **`data_only=False`** is required on load to preserve formulas (default for openpyxl, but pinned explicitly). `keep_vba` is **only needed if the workbook contains macros** — the Broadcom P&P workbooks are macro-free, so the flag is optional/defensive. If a future workbook version ships with macros, the flag must be set. The script logs every write with `(sheet, cell, before, after)` and refuses to overwrite a formula cell unless `--force-overwrite-formulas` is passed.

Phase 1.5 builds a one-time `test-fixtures/workbook/workbook-cell-meta-{version}.json` per workbook capturing:
- For each cell-map target: `dataType` (`"s"` / `"n"` / `"f"`), `value` (current sample), `dataValidation` (if any), `mergedRange` membership.
- Stamped into CI: any drift between this fixture and the pristine workbook fails the `verify-cell-map` check.

**Pros:**
- Zero browser dependencies — pure CSV emission
- Cell-address mapping table is the single source of truth — reusable for Path B and Path C
- Trivial test: CSV row count, cell addresses match a fixture (one fixture per supported version)
- Round-trippable: stamp script can also DUMP a workbook to the same CSV format, which feeds the import direction
- **Version-explicit**: every row carries its workbook version, so mistakes are caught at stamp time

**Cons:**
- Two-step UX: download CSV, then run script
- User must trust/run an external script
- The user must have the matching pristine workbook locally (the stamp script could fetch from Broadcom techdocs on first run as a convenience)

**Engine changes:**
- New `emitWorkbookCellMap(fleet, fleetResult, options?)` in [engine.js](engine.js) alongside the existing `emitWorkbookRows`. Returns an array of `{ workbookVersion, sheet, cell, label, value }`. `options.workbookVersion` defaults to `fleet.vcfVersion`.
- A new constant `WORKBOOK_CELL_MAP` declares the cell-address-to-value-resolver lookup table. Each entry has shape:
  ```js
  { sheet: "Deploy Management Domain", cell: "K38", label: "VCF Instance Name",
    workbookVersions: ["9.0", "9.1"],   // present in both
    resolve: (fleet, ctx) => ctx.instance.name }
  ```
  9.1-only entries carry `workbookVersions: ["9.1"]`; 9.0-only entries (none expected today) would carry `["9.0"]`. The emitter filters by the requested version.
- **Per-version cell address overrides** (when a cell moved between versions): an optional `cellByVersion: { "9.0": "K65", "9.1": "K67" }` field overrides `cell` for the specified version. Most cells share addresses, so this stays sparse.
- Per-domain expansion: for templates like `K128 = Host #1 FQDN`, the cell address pattern repeats by host index (K128-K143). The mapping table needs a "loop" form (`expandsTo: 16`) for repeated rows.

**UI changes:**
- New "Export Workbook Cell Map (CSV)" button alongside the existing one. Keep the old freeform CSV — useful for human-readable reference. The export uses `fleet.vcfVersion` automatically; surface the chosen version in the button label (e.g. "Export Workbook 9.1 Cell Map") so users see which workbook they'll be stamping.
- Add a small "How to use this" link to a help modal explaining the stamp script and where to download the matching pristine workbook.

**Tests:**
- New `tests/unit/workbook-cell-map.test.js`
- Validates: mapping table is well-formed, every entry has a unique `sheet+cell+workbookVersion`, `resolve` returns a string or null, fixtures produce expected cell counts.
- **Per-version assertions**: VCFMS cells appear only in the 9.1 export; vCenter storage cells reflect 9.1 values when `fleet.vcfVersion === "9.1"` (e.g. K92 default → 858 GB worth).
- Round-trip: serialize fleet → CSV → re-parse via a `parseWorkbookCellMap` helper → assert recovered fleet fields equal original.

**Stretch — `scripts/stamp-workbook.py`:** small Python helper (committed, not bundled) that stamps a downloaded copy of the official workbook. Document in README. Supports both 9.0 and 9.1 via the per-row workbookVersion column.

### Path B — Workbook-shaped CSV (rejected — see Appendix D)

This intermediate "human-readable" CSV format was evaluated and rejected in favor of going directly to Path C (.xlsx native). Full discussion preserved in Appendix D.

### Path C — Native .xlsx download (~500 LOC + library, best UX)

**What it produces:** A single-click download of a populated copy of the official workbook.

**Library options:**

| Lib | Browser size | Reads .xlsx | Writes .xlsx | Notes |
|---|---|---|---|---|
| SheetJS (xlsx) | ~620 KB minified | ✅ | ✅ | Most popular, free core |
| ExcelJS | ~900 KB | ✅ | ✅ | Better styling support, heavier |
| Hand-rolled OOXML | 0 KB external | ❌ (would need writing) | ✅ (lots of code) | Plausible but multi-week |

**Build:** `scripts/build-html.mjs` already inlines [engine.js](engine.js) into the HTML. SheetJS would similarly be inlined as a `<script>` block; bundled file grows by ~620 KB minified or ~150 KB gzipped (Vite/Rollup default).

**Workflow (dual-version):**
1. The studio either bundles or fetches the right pristine workbook based on `fleet.vcfVersion`:
   - `vcf-9.0-planning-and-preparation-workbook.xlsx` (when `vcfVersion === "9.0"`)
   - `vcf-9.1-planning-and-preparation-workbook.xlsx` (when `vcfVersion === "9.1"`)
   Bundling both as base64 in the HTML would add ~2.4 MB raw / ~3.2 MB base64 — pushes the single-HTML strategy uncomfortably close to its limits. Recommend fetch-on-demand from Broadcom techdocs (or a known local path) with a graceful fallback that produces Path A's CSV if the .xlsx can't be reached.
2. On "Export Workbook," load the version-matched pristine workbook in-memory via SheetJS, stamp every cell from the cell-map table (filtered to `fleet.vcfVersion`), hand the result back as a Blob, trigger download.

**Pros:**
- One-click UX matching expectations for a design tool
- No manual paste, no external scripts
- Output is a real `.xlsx` that opens in Excel, Google Sheets, LibreOffice
- The pristine .xlsx is the source of truth for cell addresses — easier to verify against the real workbook than maintaining a static cell-map table.

**Cons:**
- ~620 KB bundle increase (SheetJS)
- Workbook file shipping — license/redistribution question (the P&P workbook is a Broadcom techdocs public asset; need to confirm OK to bundle vs. requiring user to drop their own copy in a known path)
- Excel can be picky about file integrity — SheetJS sometimes drops styles/named ranges when re-writing; needs verification against the actual workbook before committing
- Workbook version drift: if Broadcom ships a 9.0.x or 9.1.x update with new cells, the cell-map table needs to update
- **Dual workbook maintenance**: every cell address must be re-verified when either workbook gets a Broadcom-issued update

**Why this might still be right:** Consultant audiences value zero-friction handoff. A button that produces a Broadcom-formatted workbook is the deliverable they actually want.

## 5. Bidirectional import — Workbook → Studio

Independent of which path above ships first, the cell-map table from Section 4 is the foundation for import. Once you have a `WORKBOOK_CELL_MAP` array with `{ sheet, cell, resolve, workbookVersions }`, you can:

1. **Detect the workbook version**, in this priority order:
   1. Read `Sheet2!J16` — it holds the literal version string (`9.0.2.0` / `9.1.0.0`). If the cell parses to a known version, use it. (Section 3 documents the corroborating cells.)
   2. Fall through to sheet-name presence (`"Cyber Recovery"` → 9.1).
   3. Fall through to VCFMS cell presence (L168–L170 / L117–L120 populated → 9.1).
   4. Fall through to Static Reference Tables value match (vCenter Medium default = 858 → 9.1).
   5. If still ambiguous, prompt the user via a dropdown.
   Surface the chosen heuristic and the cell evidence in the import confirmation dialog (e.g. "Detected VCF 9.1 from cell `Sheet2!J16` = '9.1.0.0'") so the user can override.
2. Parse the workbook (CSV cell-map format from Path A, or .xlsx via SheetJS for Path C).
3. **Filter the cell map** to entries whose `workbookVersions` includes the detected version.
4. For each known cell, look up the value.
5. Apply to a draft fleet object using `apply(fleet, ctx, value)` — the inverse of `resolve`.
6. **Pre-flight diff before reconcile.** Before running `reconcileFleetVersion()`, compute what it would strip: enumerate stack entries on the draft fleet whose appliance has `availableInVersions` excluding the target version. If non-empty, surface the list in a confirmation dialog ("Importing as 9.0 will remove 2 VCFMS entries from your management stack. Continue?") and only proceed on user confirm. **Never silently drop user-entered data.**
7. Run `reconcileFleetVersion()` (from Plan 12) on the confirmed draft fleet to enforce VCF-version invariants.

### Feasibility

**More feasible than the initial agent audit suggested.** Blockers from that audit reconsidered:

| Blocker (claimed) | Reality |
|---|---|
| "No unique IDs in workbook" | True, but per-cluster cells are deterministic by sheet (Sheet 4 = mgmt domain, Sheet 7 = wld domain #1, Sheet 10 = additional cluster). The studio uses generated IDs internally — import creates them. |
| "Free-form text vs structured objects" | False for the cells the studio cares about. VLAN cells are integers, CIDR cells are CIDR, FQDN cells are FQDN. Parsing is straightforward. |
| "No secrets storage" | Correct — and that's by design. Passwords are simply skipped on import. |
| "Conflict resolution" | Real concern but solvable: show a 3-way diff (current studio state vs. imported workbook vs. proposed merged state) before applying. |
| "Multi-version detection" (new for v9 / dual workbook era) | Solvable via Section 3 strategies. Most reliable: detect 9.1-only sheets ("Active Directory Inputs", "Private AI Ready Infrastructure"). |

### Open questions for import

1. **One workbook = one VCF instance, or one fleet?** The workbook's Sheet 4 has slots for ONE mgmt domain; Sheets 7/9/10 add workload domains and clusters. So one workbook covers one VCF instance. Multi-instance fleets would need multiple workbooks (or a future "Federated Fleet" sheet — doesn't exist today).
2. **Greenfield import vs merge?** Greenfield: workbook becomes the entire studio state. Merge: workbook updates an existing studio fleet. Greenfield is simpler — start there.
3. **Round-trip safety:** Studio → workbook → studio should be idempotent for all cells the studio populates. The cell-map's `resolve` and `apply` must be inverses. Add a property-based test that emits-then-imports both 9.0 and 9.1 fleets and verifies fields match.
4. **Cross-version import (workbook says 9.0, host fleet says 9.1):** Refuse and prompt the user, mirroring how `importAsNewInstance` already handles JSON-import version mismatch (Plan 12). Reuse `reconcileFleetVersion()` to enforce invariants after the user picks a target.
5. **What if version detection is ambiguous?** (e.g. user pasted a 9.0 workbook but populated a VCFMS cell that 9.0 doesn't know about). Default to surfacing the detected mismatches in a pre-import diff modal; let the user choose.

### Estimated effort

- Import (greenfield, Path A CSV input): ~250 LOC + reuse of cell-map table → 2-3 days
- Import (.xlsx input via SheetJS): ~150 additional LOC + library work → 1-2 more days
- **Workbook version detection** (sheet-presence + cell-presence heuristics + prompt fallback): ~80 LOC → 0.5-1 day
- **Cross-version import dialog** (mirror Plan 12's `importAsNewInstance` mismatch handler): ~50 LOC → 0.5 day
- Conflict-resolution / merge UI: 1-2 weeks. Defer to a Plan 11-Phase-4 or successor plan.

## 6. Recommended sequencing

The original plan put Path A (CSV + Python stamp script) as Phase 1. Round 1 review pushed back: that's a 4-step UX wall for the consultant audience (download CSV → install Python + openpyxl → fetch pristine workbook → run script). The revised sequencing keeps Path A's cell-map table as the engineering foundation but treats Path C (native `.xlsx` via SheetJS) as the **primary user-facing deliverable**.

**Phase 0 — Cell-address extraction (research, no code).** Before any code lands, produce `test-fixtures/workbook/workbook-cell-meta-9.0.json` and `workbook-cell-meta-9.1.json` by parsing the pristine workbooks. These pin sheet names, cell addresses, labels, data types, data-validation lists, and merged ranges for every cell the studio intends to write. Output is the canonical reference Phase 1 implements against.

**Phase 1 — Cell-map table + CSV emitter + Path C native .xlsx export.** Ship the engineering plumbing AND the user-facing button together. The cell-map is the single source of truth for both consumers.

- New `WORKBOOK_CELL_MAP` constant in [engine.js](engine.js) — entries tagged with `workbookVersions: ["9.0", "9.1"]` or version-specific subsets, with `cellByVersion` overrides where rows shifted in 9.1
- New `workbookVersionForFleet(fleet)` helper (also exported) — translates `fleet.vcfVersion` to the target workbook version via the `VCF_TO_WORKBOOK_VERSION` table (see Appendix C). Defaults to `DEFAULT_VCF_VERSION_LEGACY` when `fleet.vcfVersion` is undefined. **All emitters route through this helper** instead of reading `fleet.vcfVersion` directly, so future cases like "9.2 fleet exports against the 9.1 workbook because no 9.2 workbook has shipped yet" work without per-call-site logic.
- New `emitWorkbookCellMap(fleet, fleetResult, options?)` function — uses `workbookVersionForFleet(fleet)` to pick the workbook version
- New `emitWorkbookXlsx(fleet, fleetResult, pristineWorkbookBlob, options?)` function — uses SheetJS (inlined into the bundle) to load a user-supplied pristine workbook and stamp every cell from the cell-map. Browser-side, one-click download once the workbook is loaded.
- **Pristine workbook supplied by the user via file picker** — the studio shows a small "Drop the official VCF {version} Planning & Preparation Workbook here" UI on first `.xlsx` export per session. **Caching**: hold the parsed `XLSX.WorkBook` JS object in a module-scoped ref for the tab's lifetime; don't persist to `sessionStorage` (a ~3 MB blob serialized as base64 would push past the 5 MB storage quota with both 9.0 and 9.1 cached, and `Blob` doesn't natively JSON-serialize). UX consequence: reloading the page re-prompts for the workbook on the next export. Document this explicitly in the help modal. **No CORS fetch from Broadcom techdocs** (Broadcom's CDN does not advertise `Access-Control-Allow-Origin: *`, so the browser cannot fetch the .xlsx cross-origin). This also resolves the license/redistribution question and lets the user run offline. The help modal links the user to the Broadcom techdocs URL for download.
- New UI buttons next to the existing CSV export: "Export VCF {version} Workbook (.xlsx)" (primary) and "Export Workbook Cell Map (CSV)" (power-user fallback). Both buttons use `fleet.vcfVersion` automatically and surface the version in the label.
- New tests, including version-stratified snapshots: one cell-map snapshot for a default 9.0 fleet, one for a default 9.1 fleet, asserting VCFMS cells appear only in the 9.1 snapshot
- `scripts/stamp-workbook.py` helper, supports both 9.0 and 9.1 via the per-row workbookVersion column. Now a power-user/CI artifact, not the primary UX.
- `scripts/fetch-workbook.py` helper for offline use cases.
- Keep the existing 4-section CSV — it's still useful for human reference.

**Phase 1.5 — Cell-address verification (continuous during Phase 1, with a sign-off pass at the end).** Two gates, both mandatory:

- **Automated gate (continuous)**: `scripts/verify-cell-map.mjs` runs in CI on every commit touching the cell-map. For each entry's `(sheet, cellAddress)`, it asserts the pristine workbook's actual label matches the entry's expected label (case-insensitive substring), and that the target cell is not a formula cell (`data_type !== "f"`). Catches regressions immediately rather than at end-of-phase. **Wire into existing CI**: add a `npm run verify-cell-map` script in `package.json` and a matching step in `.github/workflows/test.yml` after the `test:invariants` step. The verification needs the pristine workbooks; commit a hashed manifest of expected SHA-256 sums and fetch the workbooks in CI via a separate cached step (or commit small fixture .xlsx files used only for verification).
- **Human gate (one-time at end of Phase 1)**: Implementer walkthrough captured in `test-fixtures/workbook/CELL-MAP-VERIFICATION.md` with sign-off date and SHA-256 checksums of the pristine workbooks. The implementer opens each .xlsx in Excel and visually confirms every cell-map target is the cell Broadcom actually expects users to fill (the user-value column, not the sample-formula column adjacent). Required because the automated gate only checks label text — it can't catch "we picked the sample column instead of the input column" (the exact bug Round 1 introduced with K vs. L). Gates PR 3 (final sign-off PR).

The automated gate is **continuous from PR 1 onward** — every cell-map addition runs through it. The human gate is **a one-time sign-off**, run only against the final cell-map shape, before declaring Phase 1 complete.

**Phase 2 — Greenfield import via CSV cell-map and .xlsx upload (dual-version).** Reuse the table from Phase 1 by adding an `apply` function next to `resolve`. Add an "Import Workbook" file picker that accepts either the cell-map CSV format or a stamped .xlsx (via SheetJS read-path).

- Version detection per Section 5 (Sheet2!J16 priority).
- Pre-flight diff before `reconcileFleetVersion` — surface any entries that would be stripped and require user confirmation.
- Mismatch handling mirroring Plan 12's `importAsNewInstance` dialog.

**Phase 3 — Multi-instance ergonomics + As-Built sheets.** When a fleet has 3 instances, the user gets 3 workbooks. Phase 3 ships:
- Zip download containing `{fleetName}-{instanceName}-{instanceId.slice(0,6)}-vcf{version}.xlsx` per instance plus a manifest.
- As-Built sheet output (Sheet 19 / 20) — Phase 4 territory in earlier drafts; promoted here since it shares cell-map plumbing.

**Phase 4 (optional) — Conflict-resolution merge UI.** Needed if real users start importing partially-edited workbooks back into populated studio states. Cross-version merges fall here.

**Phase 5 (optional, future) — Solution sheets.** AD Inputs, Private AI, HCX, Ransomware Recovery, Cyber Recovery. Each requires the studio to add a corresponding data model (the studio doesn't yet model AD bind config or HCX migration plans). Each sheet gets its own `workbookVersions` tag so the emitter naturally hides them on older versions.

## 7. Decisions to make before starting

| # | Decision | Default proposed | Notes |
|---|---|---|---|
| 1 | Skip Path B entirely? | Yes | Path A's stamp script is small enough that Path B's manual-paste workflow doesn't add value. |
| 2 | Ship Phase 1 + Phase 2 together, or in separate PRs? | Separate | Phase 1 standalone is shippable; Phase 2 adds review burden. |
| 3 | Where does the pristine workbook live? (Phase 3) | Don't bundle — user supplies it; ship a `scripts/fetch-workbook.{py,ps1}` helper that downloads both 9.0 and 9.1 from Broadcom techdocs on demand | License is unclear; pristine workbook is a Broadcom asset. Bundling two workbooks (~2.4 MB raw) also strains the single-HTML strategy. |
| 4 | Should `stamp-workbook.py` go in this repo? | Yes | Small helper, single file, documents the format. Must accept the per-row `workbookVersion` column and pick the matching pristine workbook. |
| 5 | Cell-map version representation: separate maps per version, or one map with per-entry tags? | **One map with `workbookVersions: ["9.0", "9.1"]` tags + sparse `cellByVersion` overrides** | Most cells are shared between versions; a tagged single map de-duplicates ~90 % of entries. Per-version maps would force duplication. |
| 6 | Do we model FQDN explicitly per appliance, or always derive from hostname + DNS domain? | Derive | FQDN = `${resolveHostname(...)}.${dns.primaryDomain}`. Avoids a new schema field. |
| 7 | What about Sheet 19/20 ("As Built") — populate them as output? | Phase 4 | These describe post-deploy state. Studio knows the intended state, so could emit them. Defer. |
| 8 | **What is the canonical source for VCFMS cell addresses in 9.1?** | The 9.1 P&P Workbook XML (extract during Phase 1.5) | This plan's K~265+ guesses are illustrative; do not hardcode them into engine.js without verification. |
| 9 | **Should the export default to `fleet.vcfVersion`, or always prompt?** | Default to `fleet.vcfVersion`, surface in the button label | A consultant designing a 9.1 fleet should not have to pick a workbook version on every export. Make the default obvious. |
| 10 | **What happens when a cell-map entry has `workbookVersions: ["9.0", "9.1"]` but Phase 1.5 reveals the cell address differs?** | Use `cellByVersion` to bind the right address per version. If the cell is genuinely gone in 9.1, drop `"9.1"` from `workbookVersions`. Never emit to a wrong address. | Phase 1.5 verification — both automated (label-match) and human (correct column) — is the gate that catches this. There is no "emit anyway and hope" fallback; that risks corrupting the stamp output. |
| 11 | **Multi-instance fleet export UX**: how does a 3-instance fleet's export materialize? | **Zip download** with one `.xlsx` per instance, naming `{fleetName}-{instanceName}-{instanceId.slice(0,6)}-vcf{version}.xlsx` + a `MANIFEST.txt` listing contents | One workbook = one VCF instance (Section 5 Q1). Avoids per-instance click loops. `instance.vcfVersion` (not `fleet.vcfVersion`) is the per-instance source of truth where Plan 12's `reconcileInstanceVersion` permits divergence. |
| 12 | **Cell-map `scope` enum — final list**? | `["per-fleet", "instance", "mgmt-domain", "mgmt-cluster", "mgmt-cluster-host", "workload-domain", "workload-cluster", "workload-cluster-host", "additional-cluster", "additional-cluster-host", "initial-instance-mgmt-cluster"]` | Lock at Phase 1 start. Each value maps to an iteration context (which IDs the emitter walks). **Distinct from APPLIANCE_DB scopes** (`per-instance`, `per-domain`, `per-fleet`) which describe appliance placement, not workbook iteration. Section 11.1 documents the iteration semantics per scope. |
| 13 | **Stretched mgmt cluster host ordering**: how are hosts 1–N/2 vs N/2+1–N attributed in L82–L97 (9.1) / L128–L143 (9.0)? | **Hosts 1..ceil(N/2) = Site A (stretchSiteIds[0]), ceil(N/2)+1..N = Site B (stretchSiteIds[1])**. For 8 hosts: A=4, B=4. For odd counts (rare; stretched clusters typically deploy even host counts for symmetry): Site A gets the extra host (ceil). For 9 hosts: A=5, B=4. The studio surfaces a warning when a stretched cluster has an odd host count (`validateNetworkDesign` / `analyzeStretchedFailover`); export emits the rows in this order regardless. | Matches Broadcom's documented convention. Lock with a fixture: a stretched-mgmt fleet's export must round-trip the per-host site affinity, including the odd-count case. |
| 14 | **Cells whose scope filter rejects the current iteration**: omit from CSV, or emit as blank? | **Emit as blank** | Otherwise the stamp script leaves Broadcom's sample-formula value untouched, and the consultant sees stale sample data instead of "this field is intentionally empty for this instance." |
| 15 | **What about VCFMS cells on instance #2 of a multi-instance fleet?** | Emit blank rows for L168/L169/L170/L176/L117–L120 on every workbook except the initial instance's | VCFMS is `scope: "initial-instance-mgmt-cluster"` (per-fleet placement). Consistent with #14 above. |
| 16 | **Cell-map `apply` for cells with `dataValidation` enum**: how strict? | Match case-insensitively against the enum, normalize to the canonical case before applying to the studio model | Avoid silent data loss when the user hand-edits a value like "medium" instead of "Medium." |

## 8. Risks

1. **Cell address drift across workbook minor versions.** Broadcom may renumber rows in a 9.0.x or 9.1.x update. Mitigation: pin `workbookVersions` on every cell-map entry, and ship a `verify-cell-map.{py,mjs}` script that opens both pristine workbooks and asserts every claimed cell still carries the expected label.
2. **Round-trip lossiness.** Some studio-internal fields (`cluster.id`, `cluster.key`, host order in `hostOverrides`, `_migrated` transient markers) have no workbook representation. On round-trip, IDs get regenerated — downstream consumers tied to studio IDs lose continuity. Mitigation: documented behavior, not a defect.
3. **Naming-template-dependent FQDNs.** If the user hasn't configured a naming template (Plan 7), FQDN cells in the export are blank. That's intended, but it surprises users. Mitigation: pre-flight check on export — if `namingConfig.hostTemplate` is empty AND the user is exporting a workbook, surface a warning recommending they set a template first.
4. **Secrets temptation.** Once the export covers 90 % of cells, users will ask "why not passwords too?" Hold firm: design tool ≠ secrets store. Document explicitly in the export modal.
5. **Workbook copyright/redistribution.** If Phase 3 bundles the pristine workbook, we'd need to confirm Broadcom's redistribution terms. Safer fallback: user supplies their own .xlsx; studio just stamps it.
6. **Version mismatch on stamp.** A user exports a 9.1 cell-map CSV but feeds it to a 9.0 pristine workbook (or vice-versa). The `openpyxl` script silently writes to whatever cells exist — including ones whose semantics may have changed. Mitigation: `stamp-workbook.py` reads the per-row `workbookVersion`, picks the matching pristine workbook, and refuses to proceed if the user passes a `--workbook` flag that contradicts the CSV header.
7. **Inferred-version surprise on import.** The version detector picks the wrong version and the user gets a fleet sized for the wrong VCF release. Mitigation: never silently default — always show the inferred version in the import confirmation dialog, with the heuristic evidence ("Detected 9.1 because: 'Active Directory Inputs' sheet present, VCFMS cells populated").
8. **Mixed-version workbook.** A user hand-edits a 9.0 workbook and adds VCFMS cells by hand (treating it as a 9.1-shaped workbook). The cell-map import sees the values but the user's host workbook is still labeled 9.0. Mitigation: refuse on conflicting evidence; require the user to resolve.
9. **Active Directory inputs are credential-adjacent.** The 9.1 AD sheet asks for bind DN and OU paths — *not* the bind password (kept out of scope). Mitigation: model only the non-secret AD fields if and when we add them; explicitly document the exclusion list.
10. **9.0 deprecation timing.** When Broadcom EOLs the 9.0 workbook (no exact date yet), maintaining the dual cell-map adds overhead. Mitigation: the `workbookVersions` tag makes it cheap to drop 9.0 entries later — just remove `"9.0"` from each entry's array and the emitter naturally stops covering it.
11. **openpyxl writes into formula cells.** Most damaging brittleness mode — silently overwrites Broadcom's sample-formula wiring. Mitigation: Section 4's `verify-cell-map.mjs` refuses to allow a cell-map entry whose target cell carries a formula in the pristine workbook (data type `"f"`). The verify step is CI-mandatory, not optional.
12. **openpyxl writes into merged ranges.** Raises `MergedCell.value setter` errors. Mitigation: stamp script enumerates `ws.merged_cells.ranges` per sheet and refuses (or redirects to top-left) for any cell-map target in a merged range. Documented in the cell-map's per-entry `cellMeta` field.
13. **openpyxl writes outside data-validation enums.** Producing a workbook Excel flags as invalid. Mitigation: cell-map entries with a `dataValidation` constraint MUST carry the canonical `allowedValues` list; emitter normalizes case before write.
14. **Wrong column targeting** — the entire class of "K vs L" bugs Round 1 caught. Mitigation: Phase 1.5's human verification gate (Section 6) catches this; the automated gate cannot. Without both gates, this risk is HIGH.
15. **User declines or mis-supplies the pristine workbook on file-picker**. Path C asks the user to drag-and-drop the official pristine .xlsx the first time they export. If they cancel the file picker, supply a non-workbook file, or supply the wrong version (9.0 file for a 9.1 fleet), the .xlsx export must degrade gracefully. Mitigation: (a) detect the workbook version from `Sheet2!J16` immediately on drop and refuse with a clear error if it doesn't match `workbookVersionForFleet(fleet)`; (b) if the user cancels, fall back to the CSV cell-map download with a toast: "No workbook supplied — saved as cell-map CSV; run `stamp-workbook.py` to produce the .xlsx, or click Export again to try the file picker."

## 9. Files that would change (Phase 0 + Phase 1)

Honest re-baseline after Round 1 review surfaced under-estimation of cell count (likely 180–250 entries, not 120) and added Path C native .xlsx work to Phase 1.

| File | Change | LOC / row est |
|---|---|---|
| `test-fixtures/workbook/workbook-cell-meta-9.0.json` | NEW — Phase 0 output: every cell-map target's `(sheet, cell, dataType, label, dataValidation, mergedRange)` extracted from pristine 9.0 workbook | ~200 entries |
| `test-fixtures/workbook/workbook-cell-meta-9.1.json` | NEW — Same for 9.1 | ~220 entries |
| `test-fixtures/workbook/CELL-MAP-VERIFICATION.md` | NEW — Phase 1.5 human-verification checklist + workbook SHA-256 checksums + sign-off | ~100 lines |
| [engine.js](engine.js) | Add `WORKBOOK_CELL_MAP` constant (~180–250 entries tagged with `workbookVersions` + `cellByVersion` overrides) + `emitWorkbookCellMap` function + `emitWorkbookXlsx` function (SheetJS path) | ~1400 |
| [engine.js](engine.js) | Export new symbols on `VcfEngine` (`WORKBOOK_CELL_MAP`, `emitWorkbookCellMap`, `emitWorkbookXlsx`, `parseWorkbookCellMap`, `SUPPORTED_WORKBOOK_VERSIONS`, `VCF_TO_WORKBOOK_VERSION`) | ~6 |
| [vcf-design-studio-v9.jsx](vcf-design-studio-v9.jsx) | Destructure new symbols; add primary "Export VCF {version} Workbook (.xlsx)" + secondary "Export Workbook Cell Map (CSV)" buttons (version-templated labels) | ~80 |
| [vcf-design-studio-v9.jsx](vcf-design-studio-v9.jsx) | Help modal explaining the .xlsx vs CSV options + where to download pristine workbooks | ~80 |
| SheetJS inline (or vendored) | NEW — `xlsx-full.min.js` for browser-side .xlsx read/write; ~620 KB minified / ~150 KB gzipped | external lib |
| JSZip inline (or vendored, Phase 3 — multi-instance) | NEW — required for the per-instance .zip download in Phase 3; ~50 KB minified / ~13 KB gzipped | external lib |
| `scripts/stamp-workbook.py` | NEW — stamp script with openpyxl safeguards (sheet-name validation, formula-cell refusal, merged-range detection, data-validation case normalization) | ~180 |
| `scripts/fetch-workbook.py` | NEW — downloads `vcf-9.0-…xlsx` and/or `vcf-9.1-…xlsx` from Broadcom techdocs; caches locally | ~40 |
| `scripts/verify-cell-map.mjs` | NEW — opens both pristine workbooks via SheetJS (or a Node xlsx lib) and asserts cell-map labels match; runs in CI | ~150 |
| `tests/unit/workbook-cell-map.test.js` | NEW — fixture-based tests of the cell-map emitter, with version-stratified snapshots | ~280 |
| `tests/unit/workbook-xlsx-emitter.test.js` | NEW — fixture-based tests of the SheetJS native .xlsx output | ~180 |
| `test-fixtures/workbook/workbook-9.0-default-ha.csv` | NEW — committed snapshot of the 9.0 cell-map for the default HA fleet | ~150 rows |
| `test-fixtures/workbook/workbook-9.1-default-ha.csv` | NEW — committed snapshot of the 9.1 cell-map (includes VCFMS cells) | ~170 rows |
| `test-fixtures/workbook/workbook-9.0-default-ha.xlsx` (binary, .gitignore the pristine workbook itself; only the diff fixture) | NEW — small diff fixture (stamped cells only) for round-trip tests | binary |
| `tests/unit/engine-smoke.test.js` | Add new symbols to `EXPECTED_SYMBOLS` | ~6 |
| [README.md](README.md) | New "Workbook Export (VCF 9.0 / 9.1)" section explaining the two paths | ~80 |
| [VCF-9.1-DELTA.md](VCF-9.1-DELTA.md) | Cross-link from the delta doc to the cell-map plan once shipped | ~10 |

**Total Phase 0 + Phase 1 estimate:**
- **Code/test LOC**: ~2200 LOC (engine + emitters + UI + tests + scripts) + ~320 rows of committed CSV fixtures
- **Bundle size impact**: +620 KB SheetJS (Phase 1) + ~50 KB JSZip (Phase 3 only)
- **Cell-map authoring (humans, not LOC)**: ~200 entries with mixed complexity:
  - Trivial fields (DNS server #1, instance name, etc.) — ~3 min/entry × ~140 entries = ~7 hours
  - Dense fields (per-host expansion, VCFMS pool arithmetic, stretched-cluster odd-host attribution, `dataValidation` enum extraction, `cellByVersion` overrides) — ~20 min/entry × ~60 entries = ~20 hours
  - Realistic total: **25–35 hours authoring** + ~5–8 hours Phase 1.5 sign-off pass = ~30–43 hours total cell-map work.
  - Calendar estimate: 5–7 working days *just for the cell-map authoring*, separate from engine/UI work. Engine/UI code is parallelizable.

Split into 3 PRs for review tractability. Each PR has its own ship gate; PR1 ships before PR2 starts review:

- **PR 1 (Phase 1a — CSV path)**: Phase 0 cell-meta fixtures + `WORKBOOK_CELL_MAP` constant + `emitWorkbookCellMap` (CSV path) + tests + Python stamp script + `scripts/verify-cell-map.mjs` (gates this PR). No UI change beyond adding the "Export Workbook Cell Map (CSV)" button.
- **PR 2 (Phase 1b — native .xlsx)**: SheetJS integration + `emitWorkbookXlsx` + file-picker for the pristine workbook + .xlsx export button + .xlsx tests. UI change.
- **PR 3 (Phase 1.5 sign-off + docs)**: `test-fixtures/workbook/CELL-MAP-VERIFICATION.md` with human sign-off + README updates + cross-references.

**Calendar estimate (honest):** 2.5–3 weeks for one engineer working through all three PRs, including code review cycles. The cell-map authoring + verification dominates the schedule; engine/UI code is roughly 1 week.

## 10. Resuming this work later

```bash
git checkout main
git pull
git checkout -b plan-11-workbook-interop
cat PLAN-11-WORKBOOK-INTEROP.md  # this file
cat VCF-9.1-DELTA.md             # 9.0 → 9.1 deltas this plan must consume
```

Start with Section 6 Phase 1. The cell-map table in Section 3 is the prework — flesh it out into a real JS constant in `engine.js`, with one entry per workbook cell the studio can populate, **tagged with the workbook versions it applies to**. Everything else cascades from that.

### Quick-start: minimum viable cell-map shape (v9 / dual-version era)

```js
const SUPPORTED_WORKBOOK_VERSIONS = ["9.0", "9.1"];

// Map a fleet's vcfVersion to the workbook version it targets. When 9.2 ships
// without a new workbook, add { "9.2": "9.1" } so 9.2 fleets still export.
const VCF_TO_WORKBOOK_VERSION = { "9.0": "9.0", "9.1": "9.1" };

const WORKBOOK_CELL_MAP = [
  // ─── Shared between 9.0 and 9.1 (column L = user-value column) ─────────
  { sheet: "Deploy Management Domain", cell: "L38",
    label: "VCF Instance Name",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    resolve: (fleet, ctx) => ctx.instance?.name || "",
    apply:   (fleet, ctx, value) => { ctx.instance.name = String(value || ""); } },

  { sheet: "Deploy Management Domain", cell: "L39",
    label: "Management domain name",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-domain",
    resolve: (fleet, ctx) => ctx.domain?.name || "",
    apply:   (fleet, ctx, value) => { ctx.domain.name = String(value || ""); } },

  // vCenter storage size — exists in both versions, but the cell moved in
  // 9.1 to an API-only customization section (L326). The cell-map uses
  // cellByVersion to bind the right address per workbook version.
  { sheet: "Deploy Management Domain",
    cell: "L92", cellByVersion: { "9.1": "L326" },
    label: "vCenter Appliance Storage Size",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster",
    dataValidation: ["default", "large", "x-large"],
    resolve: (fleet, ctx) => {
      const e = (ctx.cluster.infraStack || []).find((x) => x.id === "vcenter");
      return e?.storageProfile || "default";
    },
    apply: (fleet, ctx, value) => {
      const e = (ctx.cluster.infraStack || []).find((x) => x.id === "vcenter");
      if (e) e.storageProfile = String(value || "default").toLowerCase();
    } },

  // Per-host expansion — Host #1..#16 FQDN. Block moved from L128–L143 in
  // 9.0 to L82–L97 in 9.1; use cellByVersion overrides on the base address.
  { sheet: "Deploy Management Domain",
    cell: "L128", cellByVersion: { "9.1": "L82" },
    label: "Host #{i+1} FQDN",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster-host",
    expandsTo: 16,
    // Host ordering on stretched clusters: 1..N/2 = stretchSiteIds[0],
    // N/2+1..N = stretchSiteIds[1] (Broadcom convention, locked in Decision 13).
    resolve: (fleet, ctx, i) => {
      const hn = resolveHostname(fleet, ctx.instance, ctx.domain, ctx.cluster, i);
      const dn = fleet.networkConfig?.dns?.primaryDomain;
      return hn && dn ? `${hn}.${dn}` : (hn || "");
    } },

  // ─── 9.1-only: VCFMS Kubernetes control plane ──────────────────────────
  // VCFMS sizing is reference-only in the workbook (Static Reference Tables
  // B271–B306) — there are NO user-input cells for Control / Worker node SIZE.
  // The following are the only VCFMS-related user-input cells. ALL live on
  // "Deploy Management Domain" (sheet 5 in 9.1) — NOT the Configure sheet.
  { sheet: "Deploy Management Domain", cell: "L168",
    label: "Instance Components FQDN",
    workbookVersions: ["9.1"],
    scope: "initial-instance-mgmt-cluster",
    resolve: (fleet, ctx) => /* naming template + DNS domain */ "" },

  { sheet: "Deploy Management Domain", cell: "L169",
    label: "Identity Broker FQDN",
    workbookVersions: ["9.1"],
    scope: "initial-instance-mgmt-cluster",
    resolve: (fleet, ctx) => /* naming template + DNS domain */ "" },

  { sheet: "Deploy Management Domain", cell: "L170",
    label: "VCF services runtime FQDN",
    workbookVersions: ["9.1"],
    scope: "initial-instance-mgmt-cluster",
    resolve: (fleet, ctx) => /* naming template + DNS domain */ "" },

  { sheet: "Deploy Management Domain", cell: "L176",
    label: "VCF Automation services runtime FQDN",
    workbookVersions: ["9.1"],
    scope: "initial-instance-mgmt-cluster",
    resolve: (fleet, ctx) => /* naming template + DNS domain */ "" },

  { sheet: "Deploy Management Domain", cell: "L117",
    label: "VCFMS Node IPv4 IP Range — From",
    workbookVersions: ["9.1"],
    scope: "initial-instance-mgmt-cluster",
    resolve: (fleet, ctx) => ctx.cluster?.networks?.mgmt?.pool?.start || "" },

  { sheet: "Deploy Management Domain", cell: "L118",
    label: "VCFMS Node IPv4 IP Range — To",
    workbookVersions: ["9.1"],
    scope: "initial-instance-mgmt-cluster",
    resolve: (fleet, ctx) => {
      // Derive end IP from start + control nodes (1 or 3 depending on size)
      // + workers. The workers count is NOT fixed at 3/4 — it follows
      // `entry.instances` on the vcfmsWorker stack entry so user-customized
      // counts (e.g. 5 workers) round-trip correctly.
      const workerEntry = (ctx.cluster.infraStack || []).find((x) => x.id === "vcfmsWorker");
      const controlEntry = (ctx.cluster.infraStack || []).find((x) => x.id === "vcfmsControl");
      const workers = workerEntry?.instances ?? 3;
      const controls = controlEntry?.instances ?? 3;
      const start = ctx.cluster?.networks?.mgmt?.pool?.start;
      return /* compute: start + (workers + controls + headroom) - 1 */ "";
    } },

  // ... ~180 more entries — exact count + addresses TBD via Phase 0 extraction.
];
```

**Resolver semantics:**
- `cell` is the default address used for all listed `workbookVersions` unless `cellByVersion[v]` overrides.
- `workbookVersions: ["9.1"]` means the entry is silently dropped from a 9.0 export.
- `dataValidation: [...]` lists the canonical allowed values when the workbook cell carries a drop-down constraint. The emitter normalizes case to match; the import-side `apply` accepts case-insensitive input and rewrites to canonical.
- `scope` tells the emitter which iteration context to bind. **The full scope enum (Decision 12):**

| `scope` value | Iterates over | Iteration count |
|---|---|---|
| `per-fleet` | Once per fleet (entire workbook) | 1 |
| `instance` | Each VCF instance | `fleet.instances.length` |
| `initial-instance-mgmt-cluster` | The mgmt cluster of `fleet.instances[0]` | 1 |
| `mgmt-domain` | Each mgmt domain on the current instance | usually 1 per instance |
| `mgmt-cluster` | Each cluster within a mgmt domain | usually 1 per mgmt domain |
| `mgmt-cluster-host` | Each host within a mgmt cluster | up to `finalHosts` of that cluster |
| `workload-domain` | Each workload domain on the current instance | variable |
| `workload-cluster` | Each cluster within a workload domain | usually 1 per WLD |
| `workload-cluster-host` | Each host within a workload cluster | up to `finalHosts` |
| `additional-cluster` | Workload-domain clusters beyond the first (Sheet 10) | variable |
| `additional-cluster-host` | Hosts of additional clusters | up to `finalHosts` |

The emitter walks the fleet, builds the right context per scope, and calls `resolve(fleet, ctx, i?)`. `i` is the loop index for `expandsTo` patterns. Cells whose scope filter rejects the current iteration emit `""` (blank), not omission — see Decision 14.

- `apply(fleet, ctx, value)` is the inverse — used by Phase 2 import. Same scoping rules. Cells without `apply` are export-only (e.g. computed FQDNs that don't have a sensible inverse).

> **Note on scope nomenclature:** The cell-map's `scope` values are **distinct from** the appliance-DB `scope` values in [engine.js](engine.js) (which use `per-instance`, `per-domain`, `per-fleet`, etc.). The two are orthogonal: appliance-DB scope describes *appliance placement*; cell-map scope describes *workbook iteration*. They happen to share the word "per-fleet" but mean different things in their respective contexts.

---

## 11. Version discrimination strategy — design notes

This is the architectural core of the dual-version plan. Three places where version awareness must be threaded:

### 11.1 Export-side: which cells to emit
- `emitWorkbookCellMap(fleet, fleetResult)` calls `workbookVersionForFleet(fleet)` to derive the target workbook version (defaults to `DEFAULT_VCF_VERSION_LEGACY` when `fleet.vcfVersion` is undefined).
- Filter `WORKBOOK_CELL_MAP` to entries where `workbookVersions.includes(workbookVersion)`.
- For each surviving entry, use `entry.cellByVersion?.[workbookVersion] ?? entry.cell` as the target cell address.
- Emit the row with `workbookVersion` as the first column.

### 11.2 Stamp-side: which pristine workbook to open
- `stamp-workbook.py` reads the first data row's `workbookVersion` column.
- Looks up the matching pristine workbook from a known map (`"9.0" → vcf-9.0-…xlsx`, `"9.1" → vcf-9.1-…xlsx`).
- If the user passes `--workbook some-file.xlsx` and it doesn't match the CSV's version, refuse with a clear error.
- If the matching pristine workbook is missing locally, point the user at `scripts/fetch-workbook.py`.

### 11.3 Import-side: which version to infer
Detection priority (updated post-Round-1 review — Section 5 has the full rationale):

1. **`Sheet2!J16`** — canonical version cell (`9.0.2.0` / `9.1.0.0`). Single deterministic lookup.
2. Sheet name set (`"Cyber Recovery"` → 9.1 only).
3. VCFMS cell presence on "Deploy Management Domain" (L168–L170 / L117–L120).
4. Static reference table values (Sheet "Static Reference Tables" — vCenter Medium default = 858 → 9.1).
5. User prompt — never silently default.

Surface the chosen heuristic and the cell evidence in the import confirmation dialog ("Detected VCF 9.1 from cell `Sheet2!J16` = '9.1.0.0'"). User can override.

After detection AND before `reconcileFleetVersion(fleet)` runs, **compute the pre-flight diff**: enumerate stack entries on the draft fleet whose appliance has `availableInVersions` excluding the target version. If non-empty, surface the list and require user confirmation. **`reconcileFleetVersion` is destructive** — running it without the pre-flight diff silently deletes user-entered data on cross-version imports. The pre-flight gate is a hard requirement of Phase 2.

**Pre-flight diff dialog skeleton** (Phase 2 deliverable):
```jsx
<ConfirmModal
  title={`Workbook detected as VCF ${target}`}
  description={`Detection evidence: ${heuristic}`}>
  {strippedEntries.length > 0 ? (
    <>
      <p>Importing as VCF {target} will remove the following entries from your fleet:</p>
      <ul>{strippedEntries.map(e => <li key={e.id}>{e.label} ({e.instance.name} / {e.cluster.name})</li>)}</ul>
      <p className="warning">Custom sizing on these entries will be lost.</p>
    </>
  ) : (
    <p>No version-exclusive entries to strip. Safe to proceed.</p>
  )}
  <Button variant="primary" onClick={confirm}>Confirm and apply workbook</Button>
  <Button variant="secondary" onClick={cancel}>Cancel — do not import</Button>
</ConfirmModal>
```

Mirrors the dialog pattern from Plan 12's `importAsNewInstance` mismatch handler in `vcf-design-studio-v9.jsx`. The "Cancel" button aborts the import entirely; no partial state is committed.

### 11.4 Test coverage
- Unit: `workbook-cell-map.test.js` asserts version filtering — given `fleet.vcfVersion = "9.0"`, no VCFMS cells appear; given `"9.1"`, VCFMS cells appear with valid sizes.
- Snapshot: `test-fixtures/workbook/workbook-9.0-default-ha.csv` and `workbook-9.1-default-ha.csv` committed; the emitter must reproduce both byte-for-byte from `newFleet()` with the right `vcfVersion`.
- Round-trip: emit 9.0 fleet → parse-and-apply → assert recovered fleet matches input on cell-map-covered fields. Repeat for 9.1.
- Cross-version: emit 9.1 cell-map → import as 9.0 (should fail or prompt for re-migration). Mirror Plan 12's `importAsNewInstance` mismatch handler.

---

## 12. Cell-map maintenance workflow

The cell-map is a long-lived artifact that needs to track Broadcom's workbook releases. Process:

1. **When a new VCF release ships** (e.g. 9.2, or a 9.1.x dot-release with renumbered cells):
   - Add the new version to `SUPPORTED_VCF_VERSIONS` (engine.js) and `SUPPORTED_WORKBOOK_VERSIONS` (cell-map).
   - Run `scripts/verify-cell-map.mjs` against the new pristine workbook — it reports cells whose label no longer matches.
   - For each mismatch: decide whether to add a `cellByVersion[newVer]` override or remove the version from the entry's `workbookVersions` array if the cell no longer exists.
   - Add the new version's CSV snapshot fixture (`test-fixtures/workbook/workbook-9.2-default-ha.csv`).
   - Update the version selector in the UI dropdown.
2. **When a Broadcom workbook update is detected** (same major.minor, new sub-version with cell drift):
   - Same verify-cell-map workflow, narrower scope.
3. **When the studio's data model grows** (a new appliance, a new sub-feature):
   - Add cell-map entries for the new fields. Mark with the workbook versions they apply to.
   - Add a fixture row.

A future enhancement: a tiny `scripts/cell-map-coverage.mjs` that, given a pristine workbook, lists the cells the studio *could* populate but doesn't (i.e. coverage gaps). Useful when triaging "why doesn't the studio export field X?" requests.

---

## 13. Cross-references

- [README.md](README.md) — studio v9 architecture; "What's New in v9" section explains the dual-version data model
- [VCF-9.1-DELTA.md](VCF-9.1-DELTA.md) — 9.0 → 9.1 changes (vCenter storage, VCFMS, new sheets)
- [engine.js](engine.js) — `applianceSize`, `availableAppliances`, `profileStack` resolvers (Plan 12) — Plan 11 reuses these for cell-value derivation
- [engine.js](engine.js) — `reconcileFleetVersion`, `reconcileInstanceVersion` (Plan 12) — Plan 11 imports use these to enforce invariants after applying a workbook
- [engine.js](engine.js) — `emitWorkbookRows` at L1605 — the existing freeform CSV emitter Plan 11's `emitWorkbookCellMap` runs alongside
- [vcf-design-studio-v9.jsx](vcf-design-studio-v9.jsx) — `importConfig` / `importAsNewInstance` handlers (Plan 12) — Plan 11's workbook import follows the same dialog/reconcile pattern
- [tests/unit/vcf-version-resolver.test.js](tests/unit/vcf-version-resolver.test.js) — resolver coverage that Plan 11's emitter depends on
- [tests/unit/workbook-rows-emitter.test.js](tests/unit/workbook-rows-emitter.test.js) — existing freeform CSV emitter tests; will need parallel maintenance alongside the new cell-map tests

---

## Appendix A — Reproduce the workbook field extraction

```bash
# Both workbooks live alongside each other in Broadcom's techdocs DAM:
curl -L -o vcf-9.0-pnp.xlsx \
  "https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/assets/vmware-cis/vcf/vcf-9.0-planning-and-preparation-workbook.xlsx"
curl -L -o vcf-9.1-pnp.xlsx \
  "https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/assets/vmware-cis/vcf/vcf-9.1-planning-and-preparation-workbook.xlsx"

for f in vcf-9.0-pnp.xlsx vcf-9.1-pnp.xlsx; do
  d="${f%.xlsx}-unpacked"
  mkdir -p "$d"
  (cd "$d" && unzip -o "../$f")
done
# Then walk xl/worksheets/sheet*.xml with the Python snippet in Section 4 of
# the original investigation in PLAN-11-WORKBOOK-INTEROP commit history.
# sharedStrings.xml has the label text; sheet*.xml has the cell positions.
```

A useful diff:
```bash
diff -u vcf-9.0-pnp-unpacked/xl/sharedStrings.xml vcf-9.1-pnp-unpacked/xl/sharedStrings.xml
```
This surfaces every label-text difference between the two workbooks (rename, new label, removed label) — the starting point for the per-version cell-map review.

## Appendix B — Sheet → studio-scope mapping (dual-version)

| Sheet | Iterates over | Repeats per | 9.0 | 9.1 |
|---|---|---|---|---|
| Sheet 4 "Deploy Management Domain" | one mgmt domain | per instance | ✓ | ✓ + VCFMS rows |
| Sheet 5 "Configure Management Domain" | one mgmt domain (post-deploy) | per instance | ✓ | ✓ |
| Sheet 7 "Deploy Workload Domain" | one workload domain | per workload domain | ✓ | ✓ |
| Sheet 9 "Configure Workload Domain" | one workload domain (post-deploy) | per workload domain | ✓ | ✓ |
| Sheet 10 "Deploy Cluster" | one additional cluster | per cluster beyond the first | ✓ | ✓ |
| Sheet "Active Directory Inputs" | one AD config | per fleet | — | NEW |
| Sheet "Cross Cloud Mobility" | HCX connector | per fleet | — | NEW |
| Sheet "Private AI Ready Infrastructure" | AI workload planning | per fleet | — | NEW (out of scope) |
| Sheet "Cloud-Based Ransomware Recovery" | recovery connector | per fleet | small section | EXPANDED |

A multi-instance / multi-WLD fleet maps to MULTIPLE workbooks. One workbook = one VCF instance.

## Appendix C — `SUPPORTED_WORKBOOK_VERSIONS` vs `SUPPORTED_VCF_VERSIONS`

The studio already exports `SUPPORTED_VCF_VERSIONS = ["9.0", "9.1"]` (Plan 12). Plan 11 introduces a parallel `SUPPORTED_WORKBOOK_VERSIONS` array on the cell-map module. These are equal today but diverge in two scenarios:

1. **A new VCF release ships with no workbook update** (Broadcom defers the workbook to the next release). The studio supports the new `vcfVersion` for sizing, but `emitWorkbookCellMap` for that version reuses the older workbook. Implement by including the new version in `workbookVersions` arrays where appropriate; the runtime maps `fleet.vcfVersion` → workbook version via a small table.
2. **A workbook update fixes a Broadcom error without a VCF release** (workbook 9.1.1). The data model is the same; only some cell addresses move. Bump the sub-version internally without exposing it through the UI.

The cell-map module's exported version list is the source of truth for "what workbook layouts the cell-map knows about." The studio's `SUPPORTED_VCF_VERSIONS` is the source of truth for "what VCF runtime versions the studio sizes for." They overlap but are not the same thing.

Concrete sketch of the mapping table:

```js
// engine.js — published alongside WORKBOOK_CELL_MAP
const SUPPORTED_WORKBOOK_VERSIONS = ["9.0", "9.1"];

// fleet.vcfVersion → workbook version to export. When 9.2 ships before its
// own workbook, add { "9.2": "9.1" } so 9.2 fleets export against 9.1.
const VCF_TO_WORKBOOK_VERSION = {
  "9.0": "9.0",
  "9.1": "9.1",
};

function workbookVersionForFleet(fleet) {
  const v = fleet?.vcfVersion || DEFAULT_VCF_VERSION_LEGACY;
  return VCF_TO_WORKBOOK_VERSION[v] || v;
}
```

## Appendix D — Path B (rejected): workbook-shaped CSV

The original plan included a "Path B" intermediate format — a multi-section CSV mirroring the workbook's visual layout, designed for users to manually paste values column-by-column into the .xlsx without running a script. Plan 11's revised sequencing makes Path C (native .xlsx) the primary user-facing deliverable in Phase 1, which obsoletes Path B.

The format would have looked like:
```csv
## Workbook: VCF 9.1 — Sheet: Deploy Management Domain — General Information
Configuration,Sample,Your Value
VCF Instance Name,San Francisco,Acme Production
Management domain name,sfo-m01,sfo-m01
DNS Domain name,rainpole.io,acme.local
```

**Pros:** Self-documenting; Excel can open the CSV directly; reuses the cell-map table from Path A internally.

**Cons:** Manual paste step (error-prone for large deployments); doesn't help with round-trip import; the workbook's actual column layout (label / sample / your-value) doesn't translate naturally to a flat CSV without disambiguation overhead.

**Why rejected:** Phase 1 now ships Path C (native .xlsx) as the primary export. Path B's middle-ground value vanishes — a user willing to do manual paste can do it directly from the cell-map CSV (Path A) without needing a sectioned format, and a user wanting one-click handoff gets it from Path C. Kept in this appendix for completeness; do not implement without re-opening the design discussion.
