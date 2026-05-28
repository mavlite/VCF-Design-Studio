# AZ1 Cell Relocation Refactor — Execution Plan

**Branch:** `refactor/az1-cell-relocation` (tag `pre-az1-relocation` at commit `364146e`)
**Created:** 2026-05-28
**Status:** C1 complete; C2 in progress

## Progress checkpoint

| Phase | Status | Commit |
|---|---|---|
| Pre-flight sanity | ✅ done | (in plan) |
| C1: helper + utilities + tests | ✅ done | `09ea26d` |
| C2: mgmt-cluster relocation | 🔨 in progress | — |
| C3: workload-cluster | ⏳ pending | — |
| C4: additional-cluster | ⏳ pending | — |
| C5: test renames + address guards | ⏳ pending | — |
| C6: CLI migrator | ⏳ pending | — |
| C7: docs (HANDOFF + VCF-NETWORKING-PATTERNS) | ⏳ pending | — |

**Quick resume**: `git log --oneline pre-az1-relocation..HEAD` to see commits since rollback anchor.

## TL;DR

The VCF Design Studio's `engine.js` stamps AZ1 mgmt/workload/additional-cluster vMotion/vSAN/hostTep network config into **Configure** sheets of the pristine VCF Planning Workbook. The pristine workbook's sample formulas show those cells are designed for **AZ2** in stretched deployments. The TRUE AZ1 cells live on **Deploy** sheets. This refactor moves the AZ1 stampings to the correct cells.

**User decisions** (locked in):
1. Hard breaking change + CLI migrator script
2. Full scope across all 3 scopes × 2 versions (7-9h estimate — actually likely 10-15h given uncovered shape complexity)
3. `useDhcp` boolean reuse for 9.1 hostTep L149 IP Assignment

## Architecture

### New helper: `_deployNetworkBlock`
Place alongside `_az2NetworkConfigEntries` in `engine.js` (~line 4540). Signature:

```js
_deployNetworkBlock(scope, sheet, networkKey, displayName, cells, shape)
```

Shape variants discovered (more may surface during implementation):

**9.0 Deploy Mgmt sheet:**
- `mgmt-90-mgmt`: VLAN, Gateway, CIDR Notation, MTU — 4 cells (L148/149/150/151)
- `mgmt-90-pool`: VLAN, Gateway, CIDR Notation, MTU, Range Start, Range End — 6 cells (L159/160/161/162/163/164 for vMotion; L166-171 vSAN; L173-178 NFS-15)
  - Range Start/End verifyLabels are protocol-specific: "vMotion IP Address Range - Start", "vSAN IP Address Range - Start", "NFS IP Address Range - Start"
- `mgmt-90-hostTep`: VLAN, IP Assignment, Pool Name, Description, CIDR, Range Start, Range End, Gateway — 8 cells (L253-L260)
  - Note quirky order: Gateway is LAST, after Range End
  - IP Assignment is a dropdown ("IP Pool" / "DHCP") — map from `useDhcp ? "DHCP" : "IP Pool"`

**9.1 Deploy Mgmt sheet:**
- `mgmt-91-mgmt`: VLAN, MTU, IPv4 gateway (CIDR notation) — 3 cells, gw+CIDR combined (L102/103/104)
- `mgmt-91-pool`: VLAN, MTU, IPv4 Gateway (CIDR notation), IPv4 address Range From, IPv4 address Range To — 5 cells (L125-129 vMotion, L133-137 vSAN, L141-145 NFS-15)
- `mgmt-91-hostTep`: VLAN, gw-CIDR-combined, IP Assignment, Range From, Range To — 5 cells (L147-L151)

**9.0 Deploy Cluster sheet:**
- 7-cell shape: VLAN, MTU, CIDR Notation, Netmask, Gateway, Range Start, Range End — matches existing `_networkPoolEntries` helper signature
- Addresses: D24-D27 mgmt (4 cells, no pool), D50-D56 vMotion, D58-D64 vSAN, D66-D72 NFS-15, D74-D80 16-series, D231+ hostTep

**9.1 Deploy Cluster sheet:** TBD — needs probe before implementing additional-cluster scope

**9.0 Deploy WLD sheet:** TBD — needs probe before implementing workload-cluster scope

**9.1 Deploy WLD sheet:** TBD

### 9.1 combined gateway-CIDR cell logic

**Emit (resolve):** `gateway && subnet ? gateway + "/" + bitsFromSubnet(subnet) : ""`. Empty string when either side is null.

**Apply:** Parse `"ip/bits"`:
- `gateway = ip` (verbatim, the user's gateway IP, not network address)
- `subnet = networkAddress(ip, bits) + "/" + bits` (network address computed via mask AND)

**Edge case:** missing slash on input → `gateway = ip`, `subnet = null` (don't guess /24).

### 9.1 hostTep IP Assignment (L149)
Map from existing `cluster.networks.hostTep.useDhcp` boolean. No new model field.
- `useDhcp === true` → stamp `"DHCP"`
- `useDhcp === false` → stamp `"Static IP Pool"` (or `"IP Pool"` for 9.0 — confirm exact dropdown value during implementation)

### AZ1 entries run unconditionally
**Critical**: do not copy-paste `_isStretchedCtx` gate from `_az2NetworkConfigEntries`. AZ1 data exists for both non-stretched and stretched clusters.

## Pre-flight sanity checks (already done)

- [x] Tag `pre-az1-relocation` created at commit `364146e`
- [x] Deploy Cluster D24+ verified as AZ1 cells (NOT off-by-one)
- [x] `useDhcp` defaults to `false` (boolean) — safe for legacy fixtures
- [x] Baseline test counts captured: 1751 unit / 60 migration / 46 snapshot / 44 invariant / 18 Playwright
- [ ] Deploy Mgmt 9.1 full shape probe (partially done — vMotion/vSAN confirmed)
- [ ] Deploy WLD 9.0 + 9.1 shape probe
- [ ] Deploy Cluster 9.1 shape probe

## Commit sequence

1. **C1: Helper + utilities + synthetic tests** (no behavior change)
   - Add `_deployNetworkBlock` helper with all discovered shape variants
   - Add `_combineGwCidr(gateway, subnet)` utility
   - Add `_parseGwCidr(combined)` utility
   - Add unit tests exercising all shape variants with synthetic fixture data
   - **Validates the architecture before any real migration**
2. **C2: mgmt-cluster relocation** (both versions)
   - Replace `_networkPoolEntries("mgmt-cluster", "Configure Management Domain", ...)` calls with `_deployNetworkBlock("mgmt-cluster", "Deploy Management Domain", ...)`
   - Add AZ2 vMotion/vSAN/hostTep entries on Configure Mgmt (Theme 19 follow-on using `_az2NetworkConfigEntries`)
   - Update theme-10 round-trip tests
3. **C3: workload-cluster relocation** (both versions)
   - Same pattern as C2 but Configure WLD → Deploy WLD
   - Probe Deploy WLD shapes before writing
4. **C4: additional-cluster relocation** (both versions)
   - Move Deploy Cluster D283+ (AZ2 cells, currently mis-mapped as AZ1) → Deploy Cluster D24+ (AZ1 cells)
   - This is the simplest scope — 9.0 Deploy Cluster matches the existing 7-cell helper shape
5. **C5: Test rename + new address guards**
   - Rename theme-10 "Configure Mgmt round-trip" → "Deploy Mgmt round-trip"
   - Add explicit address-presence assertions
6. **C6: CLI migrator** (`scripts/migrate-workbook-az1.js`)
   - Reads old (Configure-sheet) cell positions
   - Writes new (Deploy-sheet) positions
   - Smoke fixture test
7. **C7: Documentation**
   - HANDOFF.md: breaking change details + old→new cell mapping table
   - VCF-NETWORKING-PATTERNS.md: update Section 5 (Workbook Row Mapping) for new addresses
   - Update stale comments at engine.js:8530-8548

## Risk gates (run before EACH commit)

- All 1751+ unit tests pass
- All 60 migration tests pass
- All 46 snapshot tests pass (regenerate with `--update` if expected)
- All 44 invariant tests pass
- `verify-cell-map` clean — entry count delta documented
- `verify-html-sync` clean
- Manual smoke: open one stamped workbook in Excel, verify AZ1 lands on Deploy sheets

## Definition of done

- [ ] All AZ1 mgmt/workload/additional-cluster vMotion/vSAN/hostTep stamps to Deploy sheets across 9.0 + 9.1
- [ ] No AZ1 leakage to Configure sheets for any scope
- [ ] New helper handles all discovered shape variants
- [ ] All test suites green
- [ ] CLI migrator round-trips at least one fixture
- [ ] HANDOFF.md + VCF-NETWORKING-PATTERNS.md updated
- [ ] Playwright suite passes
- [ ] Branch ready to merge to main

## Architect-flagged risk inventory (8 items)

1. **Cell vs cellByVersion symmetry** — new helper must match existing `_az2NetworkConfigEntries` pattern (store both `cell` and `cellByVersion`)
2. **Stretched gate on AZ1 = BUG** — AZ1 entries run unconditionally
3. **New mgmt VLAN/Gateway/CIDR emit surface** — existing fleets may have empty values; default-emit `""` to satisfy verify-cell-map
4. **9.0 hostTep ordering quirk** — Gateway is the LAST cell on Deploy Mgmt 9.0 hostTep (L260 after L259 Range End)
5. **CSV import determinism** — sort by `(sheet, version, cell)` to absorb entry-order churn
6. **verify-cell-map's label tolerance** — new Deploy cells DO have labels; label-string typos will surface
7. **Off-by-one row risk in 5-cell blocks** — verified for Deploy Cluster; verify for Deploy WLD too
8. **Stale architecture comments** at engine.js:8530-8548 — rewrite in lockstep

## Planner-flagged tripwires

- **Mid-cluster commits NOT safe** — only commit at clean scope boundaries (between C1, C2, C3, C4)
- **3 consecutive failed verify-cell-map runs without obvious fix** → STOP, commit WIP to scratch, regroup
- **Context budget tripwires**: STOP if context <35% remaining; require >50% before C4+
- **TODO markers for NFS-secondary** (Q5 deferral) — add inline `// TODO(az1-relocation-followup): NFS-secondary model field` at the relevant cell-map sites

## Resume protocol

On any session, before resuming:
1. `git status` — confirm clean working tree
2. `git log --oneline pre-az1-relocation..HEAD` — see commits since the rollback anchor
3. Run baseline test counts
4. `npm run verify-cell-map` — confirm clean
5. Pick up at the next un-committed phase per the sequence above

## Estimated session count

Original estimate: 7-9h (one focused session).
Revised after deeper probe: 10-15h across **2-3 focused sessions** given:
- 5+ shape variants per scope (vs initial 6 total estimate)
- Each shape needs resolve/apply + verifyLabel + unit test
- 6+ test files to update
- CLI migrator is its own non-trivial unit

Realistic single-session target: **C1 (helper + synthetic tests) + C2 (mgmt-cluster only)** = 4-5h.

## Open items not yet decided

- AZ2 vMotion/vSAN/hostTep header cell stamping on Configure Mgmt (will be added in C2 alongside AZ1 relocation)
- NFS-secondary (15/16-series) model: deferred with TODO markers
- VCF Installer JSON impact (may need separate cell-mapping updates if Installer reads from Deploy sheets)
