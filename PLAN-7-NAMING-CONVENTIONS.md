# Plan 7 — Naming Conventions for Hosts and vDS Switches

> **Branch:** `plan-7-naming-conventions` (stacked on `plan-6-followups`)
> **Status:** ✅ All 6 steps complete. Tests, README, and handoff doc finalized.
> **Last commit:** see `git log plan-6-followups..HEAD` on this branch.

This file is the single source of truth for resuming Plan 7 development on another machine. It captures the design, what's already built, what's left, and exactly where to pick up.

---

## 1. Goal

Replace hardcoded `vds-mgmt`/`vds-vmotion`/etc. names and the missing-hostname gap with a token-based template system. Templates live at fleet level with optional cluster overrides. Hostnames render virtually from templates; vDS names are stored on the cluster (so users can hand-edit) but seeded from the template.

## 2. Schema

### Fleet-level config

Lives on `fleet.namingConfig`, factory `createFleetNamingConfig()`:

```js
{
  hostTemplate: "{prefix}-{site}-{role}-{seq:02}{postfix}",
  vdsTemplate:  "{prefix}-{cluster}-vds-{purpose}",
  prefix: "vcf",
  postfix: ".lab.local",   // typically the primary DNS domain
  separator: "-",          // applied inside slugs (spaces → "-")
  seqStart: 1,             // 1-indexed; vCenter indexes from 1
  seqPadding: 2,           // default zero-padding when {seq} used without :NN
}
```

**Default values** (factory): all fields empty/zero except `separator: "-"`, `seqStart: 1`, `seqPadding: 2`. **Empty templates preserve today's "no hostname / hardcoded vDS names" behavior** until the user opts in.

### Cluster-level override

Lives on `cluster.naming`, factory `createClusterNaming()`. All four fields default to `null` (= inherit from fleet):

```js
{
  hostTemplate: null,
  vdsTemplate: null,
  prefix: null,
  postfix: null,
}
```

### Per-host explicit override

Existing `cluster.hostOverrides[i]` gains one new field:

```js
{ ...existing IP overrides..., hostname: null }
```

`null` = use template; string = literal override that beats the template.

### vDS storage

`cluster.networks.vds[i].name` stays where it is — user-editable. Templates seed values via the "Re-apply naming template" UI action (Step 4); no auto-update on template edit.

## 3. Tokens

| Token | Source | Notes |
|---|---|---|
| `{prefix}` | `naming.prefix` (cluster override → fleet) | Empty string if unset |
| `{postfix}` | `naming.postfix` (cluster override → fleet) | Empty if unset; lives at the end so users can put `.fqdn.tld` here |
| `{site}` | slug of `site.name` for the cluster's site (local domain) or first stretch site | Falls back to first instance siteId |
| `{instance}` | slug of `instance.name` | |
| `{cluster}` | slug of `cluster.name` | |
| `{domain}` / `{role}` | `"mgmt"` or `"wld"` from `domain.type` | Synonyms; `{role}` reads more naturally |
| `{purpose}` | **vDS only** — `mgmt` / `vmotion` / `vsan` / `tep` / `overlay` / `sdn` / `converged` / dash-joined combos | Derived from the vDS slot's portgroup mapping in `NIC_PROFILES` |
| `{seq}`, `{seq:02}`, `{seq:03}` | Host index + `seqStart`, optionally zero-padded | `{seq:02}` → `01`,`02`; bare `{seq}` uses `seqPadding` |

### Slug rules (`slugify()`)

- Lowercase
- Replace whitespace and `_` with `separator`
- Strip everything that isn't `[a-z0-9-]` (or whatever separator is)
- Collapse runs of separator
- Trim leading/trailing separators
- Cap at `maxLen` (default 32) to keep total hostname under 64 chars

### Unknown / unfilled tokens

Render as empty string; adjacent runs of separator are collapsed. **Leading/trailing dots are NOT stripped** — postfixes like `.lab.local` need to survive intact.

Example: template `{prefix}-{site}-{role}-{seq:02}` with empty `prefix` and no site → `mgmt-01`, not `--mgmt-01`.

## 4. Engine helpers (all in [engine.js](engine.js))

All functions are exported via `VcfEngine`. Tested via `tests/unit/engine-smoke.test.js`.

| Helper | Purpose |
|---|---|
| `createFleetNamingConfig()` | Default fleet-level config |
| `createClusterNaming()` | Default cluster-level override (all null) |
| `slugify(s, separator?, maxLen?)` | Normalize strings to safe DNS-label form |
| `resolveTemplate(template, tokens, separator?)` | Replace `{token}` and `{token:NN}` with values; collapse separators |
| `mergeNamingConfig(fleetCfg, clusterCfg)` | Cluster overrides → fleet defaults |
| `hostTokensFor(fleet, instance, domain, cluster, hostIndex, cfg)` | Build host token map |
| `vdsTokensFor(fleet, instance, domain, cluster, vdsSlot, cfg)` | Build vDS token map |
| `vdsSlotPurpose(cluster, vdsName)` | Derive `{purpose}` from `NIC_PROFILES` portgroup mapping |
| `resolveHostname(fleet, instance, domain, cluster, hostIndex)` | Resolve hostname; per-host override beats template; null when no template |
| `resolveVdsName(fleet, instance, domain, cluster, vdsIndex)` | Resolve vDS name from template |
| `applyVdsTemplate(fleet, instance, domain, cluster, opts?)` | Returns new cluster with `networks.vds[].name` regenerated; `opts.preserveCustom` keeps user-edited names |

### `allocateClusterIps(cluster, finalHosts, ctx?)`

Optional 3rd arg `ctx = { fleet, instance, domain }`. When provided, every host in the result has `hostname` resolved. When omitted, `hostname: null` everywhere (preserves pre-Plan-7 callers).

### Migration backfill (`migrateV5ToV6` and `migrateFleet` final pass)

- `fleet.namingConfig` ← `createFleetNamingConfig()` if missing
- `cluster.naming` ← `createClusterNaming()` if missing
- `hostOverride.hostname` ← `null` if missing on existing entries

Idempotent: round-tripping through `migrateFleet` produces identical output.

## 5. UI changes (Steps 3 + 4 — NOT YET IMPLEMENTED)

### Step 3 — Fleet Summary "Naming" section

Location: [vcf-design-studio-v6.jsx](vcf-design-studio-v6.jsx) `FleetSummary` component (search for `function FleetSummary`).

New section with:
- Two text inputs: Host Template, vDS Template
- Two text inputs: Prefix, Postfix
- Number input: Seq Start (default 1)
- Live preview showing 3 example resolved names per template against the first cluster in the fleet
- Token reference card (collapsible) listing available tokens

Wire-up:
```jsx
const updateNaming = (patch) => onChange({
  ...fleet,
  namingConfig: { ...(fleet.namingConfig || createFleetNamingConfig()), ...patch },
});
```

### Step 4 — Per-cluster + per-host overrides

**ClusterCard** ([vcf-design-studio-v6.jsx](vcf-design-studio-v6.jsx) — search `function ClusterCard`): collapsible "Naming overrides" subsection. "Re-apply vDS naming template" button calls `applyVdsTemplate(...)` and stores the result in cluster.networks.

**Host override editor** (per-host IP grid in the Network tab): add a hostname column. Empty cell shows the resolved-from-template value greyed out; user typing stores as override.

**vDS editor** (cluster's `networks.vds[]` rows): each name field is editable; "Reset to template" button per row reverts to resolved template value.

## 6. Validators (Step 6 — IN PROGRESS)

Two new rules, returned as part of `validateNetworkDesign(fleet)`:

### VCF-NAMING-001 — Hostname uniqueness

Walk the fleet, resolve every host's hostname, check uniqueness across the entire fleet. Critical severity. Blocks export.

```js
function validateHostnameUniqueness(fleet, fleetResult) {
  const seen = new Map();              // hostname → { instanceId, domainId, clusterId, hostIndex }
  const issues = [];
  for (const inst of fleet.instances || []) {
    for (const dom of inst.domains || []) {
      for (let cIdx = 0; cIdx < (dom.clusters || []).length; cIdx++) {
        const cl = dom.clusters[cIdx];
        const ir = fleetResult.instanceResults?.find(r => r.instance.id === inst.id);
        const finalHosts = ir?.domainResults?.[dom.idx]?.clusterResults?.[cIdx]?.finalHosts || 0;
        for (let i = 0; i < finalHosts; i++) {
          const name = resolveHostname(fleet, inst, dom, cl, i);
          if (!name) continue;        // no template → skip
          if (seen.has(name)) {
            issues.push({
              ruleId: "VCF-NAMING-001",
              severity: "critical",
              message: `Hostname "${name}" collides between two hosts`,
              ...
            });
          }
          seen.set(name, { ... });
        }
      }
    }
  }
  return issues;
}
```

### VCF-NAMING-002 — Hostname format / length

Per resolved hostname:
- Each label (between dots) ≤ 63 chars
- Total FQDN ≤ 253 chars
- Labels must match `[a-z0-9]([a-z0-9-]*[a-z0-9])?` (no leading/trailing dash)

Critical severity.

### Wire into `validateNetworkDesign`

[engine.js](engine.js) — search for `function validateNetworkDesign`. Add the two new validators alongside the existing `VCF-IP-*` and `VCF-NET-*` rules.

## 7. Documentation (PENDING)

### README.md

Add new "Naming Conventions" section under "Networking Design (v6)":
- Token reference table
- Override hierarchy (fleet → cluster → per-host)
- Examples
- Mention `VCF-NAMING-001/002` validators

### VCF-DEPLOYMENT-PATTERNS.md (gitignored — local only)

Add `VCF-NAMING-001` and `VCF-NAMING-002` rule definitions in the validators section, following the existing pattern.

## 8. Tests (PENDING — should land alongside Step 6)

Create `tests/unit/naming-conventions.test.js` covering:

- **Slugify** — spaces → `-`, lowercase, strip non-alphanumeric, max-len truncation, edge cases (empty string, all-special-chars, unicode)
- **Token resolution** — each token type, sequence padding (`{seq}`, `{seq:02}`, `{seq:03}`), unknown tokens drop, separator collapsing, leading-dot preservation in postfix
- **Override hierarchy** — fleet template → cluster override → per-host literal. Per-host literal wins; cluster override falls through to fleet for unset fields
- **Empty templates preserve current behavior** — `hostTemplate: ""` produces `hostname: null` on every host; existing fixture-based tests don't break
- **vDS template re-application** — `applyVdsTemplate` produces same names as the template would; user-edited names get overwritten only when explicitly invoked
- **Migration idempotency** — running `migrateFleet` twice produces identical `namingConfig` shape
- **Round-trip** — templates survive export → import
- **Installer JSON / Workbook CSV** — emitted hostnames match resolved templates; null/empty when template is empty
- **`vdsSlotPurpose`** — derives correct purpose for each NIC profile (2-NIC converged, 4-NIC mgmt-vmotion + sdn, 6-NIC, 8-NIC)
- **Validators** — VCF-NAMING-001 catches collisions; VCF-NAMING-002 catches over-length and bad chars

## 9. Implementation status

| Step | Description | Status |
|---|---|:---:|
| 1 | Schema + factory + helpers + migration | ✅ Done |
| 2 | `allocateClusterIps` returns `hostname` | ✅ Done |
| 5 | Installer JSON + Workbook CSV pick up hostnames | ✅ Done |
| 6 | VCF-NAMING-001 + VCF-NAMING-002 validators | ✅ Done |
| 3 | UI: Fleet Summary "Naming" section with live preview | ✅ Done |
| 4 | UI: per-host hostname column + vDS Re-apply button + editable vDS names | ✅ Done |
| — | Tests file (`tests/unit/naming-conventions.test.js` — 52 tests) | ✅ Done |
| — | README.md "Naming Conventions" section | ✅ Done |
| — | VCF-DEPLOYMENT-PATTERNS.md (gitignored) | ⏳ Optional follow-up |

### What's currently committed on this branch

After Step 1 + 2 + 5 implementation:

- `engine.js` — all helpers, factory defaults, migration backfill, `allocateClusterIps` signature update, exports updated. Look for `Plan 7 — NAMING CONVENTIONS` block (~line 800).
- `vcf-design-studio-v6.html` — regenerated; HTML in sync with source.
- `tests/unit/engine-smoke.test.js` — 11 new symbols added to `EXPECTED_SYMBOLS`.
- `tests/unit/network-model.test.js` — one assertion updated for `hostname: null` backfill.
- `tests/unit/workbook-rows-emitter.test.js` — header row + first-data-row index updated for new `Hostname` column.
- `test-fixtures/snapshots/*.snap.json` — 23 snapshots regenerated (all gain `naming: {...}` on each cluster + `namingConfig` on each fleet + `hostname: null` on existing hostOverrides).

**Current test totals:** all 29 unit + 3 migration + 1 snapshot + 3 invariants test files passing (~1024+ tests).

## 10. Resuming on another machine

```bash
git fetch origin
git checkout plan-7-naming-conventions
npm install                  # if not already
npm test                     # confirm all green
npm run build-html           # confirm HTML in sync
```

### Next step is Step 6 — finish the validators

1. In [engine.js](engine.js), add `validateHostnameUniqueness(fleet, fleetResult)` and `validateHostnameFormat(fleet, fleetResult)` next to the existing `validateNetworkDesign(fleet)` function.
2. Wire them into `validateNetworkDesign` (or into a new `validateNamingDesign(fleet, fleetResult)` if separation is preferred — though network/naming are tightly coupled so one combined function is fine).
3. Export the new functions if independently testable.
4. Add tests in `tests/unit/naming-conventions.test.js` for both rules.

### Then Step 3 — Fleet Summary UI

Quickest path: find `function FleetSummary` in [vcf-design-studio-v6.jsx](vcf-design-studio-v6.jsx). Add a `<section>` with the four text inputs + seq start. Compute live preview by calling `resolveHostname` against the first cluster in the fleet for hosts 0–2. Wire `onChange` to `setFleet({ ...fleet, namingConfig: { ...fleet.namingConfig, [field]: value } })`.

### Then Step 4 — per-host + vDS UI

Per-host column: find the existing per-host IP override grid (search for `hostOverrides` or `createHostIpOverride` callers in the JSX). Add a hostname input column.

vDS Re-apply: in `ClusterCard`, add a button near the vDS section that calls `applyVdsTemplate(fleet, instance, domain, cluster, { preserveCustom: false })` and updates the cluster.

### Tradeoffs / open questions still on the table

- **Q1**: Empty default templates vs opinionated defaults. Currently empty (recommended — no surprise renames on existing fleets).
- **Q2**: Validators in same PR — currently planned same PR.
- **Q3**: Per-cluster overrides — currently designed as optional, all four fields can override individually. Could be simplified to "fleet template only" if needed.

## 11. Risks / tradeoffs (carried over from original plan)

1. **Hostname uniqueness across the fleet.** A poorly-designed template (e.g., `host-{seq:02}` with no site/cluster token) generates colliding names across clusters. Validator (`VCF-NAMING-001`) catches this; critical severity blocks export.

2. **Hostname length / format.** Templates can produce strings that violate DNS label rules (>63 chars per label, illegal characters). Validator (`VCF-NAMING-002`) checks each resolved name fits FQDN constraints. Critical severity.

3. **Slug deterministic across exports.** If the user renames a site, all resolved hostnames change. Could break external systems (DNS, monitoring) tied to those names. Worth a one-line warning on rename: "This change will modify N resolved hostnames." (Future enhancement; not in scope.)

4. **vDS name "live update."** When the user edits the fleet template, existing cluster `networks.vds[].name` values are NOT auto-updated. The user has to click "Re-apply" on each cluster. Trade-off: explicit re-apply prevents accidentally clobbering hand-edited names; but it's an extra click. **Decision: explicit re-apply for vDS, virtual/live for hostnames.** Hostnames are computed (no storage), vDS names are stored (avoids surprising users).

5. **Empty defaults vs. opinionated defaults.** Current choice: empty (existing fleets export unchanged). Alternative: opinionated (e.g., `"{prefix}-{cluster}-{seq:02}"`) — but this changes export content for all existing fleets, possibly surprising consumers.

## 12. Estimate

- Engine: ~200 LOC (already ~180 LOC done — slugify + resolveTemplate + 3 resolveX wrappers + applyVdsTemplate + migration backfill)
- UI: ~150 LOC (Fleet Summary section, ClusterCard subsection, host grid hostname column, vDS reset button)
- Export updates: ~30 LOC across emitters (DONE)
- Validators: ~60 LOC (uniqueness + format)
- Tests: ~250 LOC (one new file) + minor existing test updates (existing updates DONE)

**Total: ~700 LOC, 1 PR.**

---

## Appendix A — token examples

| Template | Resolves to (first WLD host, site "WH200", cluster "Prod 01") |
|---|---|
| `{prefix}-{site}-{role}-{seq:02}{postfix}` | `vcf-wh200-wld-01.lab.local` |
| `{site}{separator}esx{seq:02}` | `wh200-esx01` |
| `{prefix}-{cluster}-{seq:03}` | `vcf-prod-01-001` |
| `host-{seq}` (no padding) | `host-1`, `host-2`, …, `host-10` |
| `host-{seq:02}` | `host-01`, `host-02`, …, `host-10` |

| vDS template | Resolves to |
|---|---|
| `{prefix}-{cluster}-vds-{purpose}` | `vcf-prod-01-vds-mgmt-vmotion`, `vcf-prod-01-vds-sdn` |
| `vds-{purpose}` (current default) | `vds-mgmt-vmotion`, `vds-sdn` |
| `{site}-{role}-vds-{purpose}` | `wh200-wld-vds-overlay` |

## Appendix B — what each emitted host looks like before/after

**Before Plan 7** (no naming config, current behavior preserved):

```json
{
  "cluster": "wld-cluster-01",
  "hostIndex": 0,
  "hostname": null,
  "ipAddress": { "mgmtIp": "10.0.0.10", ... },
  "bmcConfig": { "ipAddress": null }
}
```

**After Plan 7** (template configured, `vcf-wh200-wld-{seq:02}.lab.local`):

```json
{
  "cluster": "wld-cluster-01",
  "hostIndex": 0,
  "hostname": "vcf-wh200-wld-01.lab.local",
  "ipAddress": { "mgmtIp": "10.0.0.10", ... },
  "bmcConfig": { "ipAddress": null }
}
```

**With per-host override** (`hostOverrides[0].hostname = "esx-special.lab.local"`):

```json
{
  "cluster": "wld-cluster-01",
  "hostIndex": 0,
  "hostname": "esx-special.lab.local",
  "ipAddress": { "mgmtIp": "10.0.0.10", ... },
  ...
}
```
