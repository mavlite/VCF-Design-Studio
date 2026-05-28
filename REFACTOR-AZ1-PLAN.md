# AZ1 Cell Relocation Refactor — Execution Plan

**Branch:** `refactor/az1-cell-relocation` (tag `pre-az1-relocation` at commit `364146e`)
**Created:** 2026-05-28
**Status:** C1 complete; C2 in progress

## Progress checkpoint

| Phase | Status | Commit |
|---|---|---|
| Pre-flight sanity | ✅ done | (in plan) |
| C1: helper + utilities + tests | ✅ done | `09ea26d` |
| C2: mgmt-cluster relocation | ✅ done | `754d702` |
| C3: workload-cluster | ✅ done | `d167bf2` |
| C4: additional-cluster | ✅ done | `a8619a0` |
| C5: test renames + address guards | ✅ done | `ef5f497` |
| C6: CLI migrator | ✅ done | `09bad8a` |
| C7: docs (HANDOFF + VCF-NETWORKING-PATTERNS) | ✅ done | (this commit) |

## C3 findings worth carrying into C4

- **Deploy Cluster 9.0 D24+ has the 7-cell helper-compatible shape** (VLAN/MTU/CIDR/Netmask/Gateway/Range Start/End) per the pre-flight probe. Likely simpler than C2/C3.
- **Theme P / hostTep collision** — when C4 maps hostTep on Deploy Cluster, check first if Theme P claims those cells (it does on Deploy Cluster D254+/D266+ per the existing `_nsxHostOverlayBlockEntries({ scope: "additional-cluster", ... })` call). Skip hostTep on Deploy Cluster to avoid double-stamping.
- **Edge TEP at additional-cluster scope** — same gap as C3; check if the existing Deploy Cluster edgeTep mapping (D307+ per existing code) targets AZ1 or AZ2 cells, and either move or remove.

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

## C2 — mgmt-cluster relocation: concrete step-by-step

### Step 1: Replace existing buggy mappings in engine.js
**File:** `engine.js` lines 8550-8563 — the `_networkPoolEntries("mgmt-cluster", "Configure Management Domain", ...)` block.

Replace with these `_deployNetworkBlock` calls (note: also need to add a NEW mapping for `mgmt` protocol itself, which wasn't previously mapped on mgmt-cluster scope):

```js
// Theme 30 — AZ1 mgmt-cluster network config on Deploy Mgmt
..._deployNetworkBlock("mgmt-cluster", "Deploy Management Domain", "mgmt", "Mgmt", {
  vlan90: "L148", gateway90: "L149", cidr90: "L150", mtu90: "L151",
  vlan91: "L102", mtu91: "L103", gwCidr91: "L104",
}),
..._deployNetworkBlock("mgmt-cluster", "Deploy Management Domain", "vmotion", "vMotion", {
  vlan90: "L159", gateway90: "L160", cidr90: "L161", mtu90: "L162",
  poolStart90: "L163", poolEnd90: "L164",
  poolStartVerifyLabel: "vMotion IP Address Range - Start",
  poolEndVerifyLabel: "vMotion IP Address Range - End",
  vlan91: "L125", mtu91: "L126", gwCidr91: "L127",
  poolStart91: "L128", poolEnd91: "L129",
}),
..._deployNetworkBlock("mgmt-cluster", "Deploy Management Domain", "vsan", "vSAN", {
  vlan90: "L166", gateway90: "L167", cidr90: "L168", mtu90: "L169",
  poolStart90: "L170", poolEnd90: "L171",
  poolStartVerifyLabel: "vSAN IP Address Range - Start",
  poolEndVerifyLabel: "vSAN IP Address Range - End",
  vlan91: "L133", mtu91: "L134", gwCidr91: "L135",
  poolStart91: "L136", poolEnd91: "L137",
}),
..._deployNetworkBlock("mgmt-cluster", "Deploy Management Domain", "hostTep", "Host TEP", {
  vlan90: "L253", ipAssignment90: "L254", poolName90: "L255",
  cidr90: "L257", poolStart90: "L258", poolEnd90: "L259", gateway90: "L260",
  vlan91: "L147", gwCidr91: "L148", ipAssignment91: "L149",
  poolStart91: "L150", poolEnd91: "L151",
}),
```

### Step 2: Move `_networkPoolNameEntry`
**File:** `engine.js` line 8554. Current: `_networkPoolNameEntry("mgmt-cluster", "Configure Management Domain", "D250", "D321")`. The 9.0 pool name on Deploy Mgmt is at **L255** (hostTep section's "Pool name"). Decide: either (a) drop the standalone entry since hostTep block now stamps L255 via `poolName90`, or (b) keep the standalone for Configure Mgmt and rely on Theme 19 AZ2-emit gating. Recommend (a) — remove the standalone entry to avoid duplicate stamping.

### Step 3: Add AZ2 mgmt-cluster mappings on Configure Mgmt
**File:** `engine.js` near existing `_az2NetworkConfigEntries` calls. Add AZ2 vMotion + vSAN (hostTep on Configure Mgmt is in a different protocol block per probe; skip):

```js
// Theme 19 follow-on — AZ2 vMotion + vSAN on Configure Mgmt
..._az2NetworkConfigEntries("mgmt-cluster", "Configure Management Domain", "vmotion", "vMotion",
  { vlan90: "D252", vlan91: "D323", network90: "D254", network91: "D325",
    gateway90: "D256", gateway91: "D327",
    poolStart90: "D257", poolStart91: "D328",
    poolEnd90: "D258", poolEnd91: "D329" }, "pool"),
..._az2NetworkConfigEntries("mgmt-cluster", "Configure Management Domain", "vsan", "vSAN",
  { vlan90: "D260", vlan91: "D331", network90: "D262", network91: "D333",
    gateway90: "D264", gateway91: "D335",
    poolStart90: "D265", poolStart91: "D336",
    poolEnd90: "D266", poolEnd91: "D337" }, "pool"),
```

### Step 4: Update theme-10 round-trip tests
**File:** `tests/unit/themes/theme-10-vcf-network-pools.test.js`. The 6 round-trip tests for Configure Mgmt should still pass (they check value round-trip, not sheet placement). Rename describe blocks from "Configure Mgmt" to "Deploy Mgmt" for accuracy.

### Step 5: Verify
- `npm run build-html`
- `npm test`
- `verify-cell-map` should add ~12 entries (8 new on Deploy Mgmt × ~2 versions, minus duplicates already at Configure Mgmt) but the count is hard to predict — confirm clean.
- `verify-html-sync` clean

### C2 expected behavior changes (breaking-change details)
- A 9.0 fleet that previously stamped `networks.vmotion.vlan = 1612` to Configure Mgmt D252 will now stamp it to Deploy Mgmt L159. Old workbooks will round-trip to empty (need migrator).
- Same for 9.1 (stamp moves from D323 to L125).
- Pool name moves from Configure Mgmt D250 to Deploy Mgmt L255 (9.0) via hostTep block.
- Existing snapshots may regen if any reference the old stamp sequence.

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
