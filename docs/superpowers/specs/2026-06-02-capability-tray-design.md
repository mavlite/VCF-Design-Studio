# Capability Tray — Progressive Disclosure Design

**Date:** 2026-06-02
**Status:** Spec (approved taxonomy + architecture; awaiting spec review → plan)
**Predecessor:** `docs/superpowers/brainstorms/2026-06-02-progressive-disclosure-session.md`

## 1. Problem

The studio renders every panel for every scope at once. A single ClusterCard
stacks ~20 collapsible `<Section>` panels (VPC, DR, NSX overlay, Supervisor,
Edge, port-groups, tiering, data services, advanced…), all visible even when
empty. A first-time user configuring a bare VCF deployment is confronted with
the full surface area of every optional capability.

The underlying model is already "minimal core + optional everything":
`newFleet()` seeds one site, one instance, one mgmt domain, one mgmt cluster,
and leaves all optional structures empty. The gap is purely **UI surfacing and
recording opt-in state** — there is no unifying layer that lets a user reveal
capabilities progressively.

## 2. Goal

Open on the bare-minimum VCF deployment. Let users layer in capabilities
(VPC, DR, NSX underlay, Supervisor, Edge, Federation, …) only when they opt in,
by generalizing the studio's scattered enable-gates
(`supervisorConfig.enabled`, `placement === "stretched"`, `federationEnabled`)
into **one capability tray per model scope**.

### Non-goals
- No new workbook cells. No new `WORKBOOK_CELL_MAP` entries, no M2.1 round-trip
  entries, no `verify-cell-map` combos. (The export path gains *enable-gates* on
  existing block-builders per §6.4, but defines no new cells.)
- No change to what gets exported when a capability is *enabled* — only whether
  its panel is shown and, for export-gated capabilities, whether its existing
  data participates in export when *disabled*.
- No new "complexity tier" global selector (rejected direction C).
- No restructuring of the existing panels' internals — they get *wrapped*, not
  rewritten.

## 3. Taxonomy (locked)

Visual rule: **grey** = always-on core (never hidden); **teal** = enabled
(panel revealed); **outline** = available, off.

| Scope | Always-on core | Opt-in capabilities |
|-------|----------------|---------------------|
| **Fleet** | DNS/NTP, Naming, Report Metadata | Identity / AD + SSO · Backup (SFTP) · Installer / Depot · NSX Federation · VCF Ops / Automation |
| **Instance** | — | DR / Warm-Standby |
| **Domain** | — | Stretched / AZ2 |
| **Cluster** | Host & Sizing, Storage (vSAN), Networking, Appliance Stack | NSX Edge + T0/BGP · NSX Host Overlay · vSphere Supervisor (VKS) · VPC / Transit Gateway · NVMe Tiering · vSAN Data Services · Custom Port-groups · Advanced (EVC / naming) |

Adding a workload domain is a **plain `+ Add` action** (structural, like
adding a cluster or site), NOT a capability chip.

## 4. Architecture — capability registry (no parallel state object)

A single `CAPABILITY_REGISTRY` declares *what* capabilities exist and how to
read/write each one's enable-state. It stores **no state of its own**. Each
entry delegates to the natural model field, so there is no parallel
`capabilities` map to drift from `supervisorConfig.enabled` et al.

```js
// engine.js — new section, after the validators.
// Each entry:
//   key        unique id, e.g. "edge"
//   scope      "fleet" | "instance" | "domain" | "cluster"
//   group      display grouping within the scope's tray (e.g. "Networking")
//   label      chip text
//   isEnabled(ctx)  -> boolean   (reads the underlying field)
//   enable(ctx)     -> void      (flips the underlying field ON)
//   disable(ctx)    -> void      (flips it OFF; never destroys data)
//   hasData(ctx)    -> boolean   (true if the capability holds non-default data)
//
// ctx is the same shape the cell-map resolvers use: { fleet, instance,
// domain, cluster } — only the fields relevant to the capability's scope
// are required to be present.
```

`isEnabled` resolves through one of three underlying representations:

**(a) Existing boolean flag** — read/write in place, no model change:

| Capability | Field |
|------------|-------|
| NSX Federation (`federation`) | `fleet.federationEnabled` (default `false`, genuine federation intent) |
| vSphere Supervisor (`supervisor`) | `cluster.supervisorConfig.enabled` (default `false`, gates panel + export today) |
| NVMe Tiering (`tiering`) | `cluster.tiering.enabled` (default `false`, drives sizing via `applyTiering`) |

> **Not reused:** `cluster.storage.dataServices.dit.enabled` is NOT a capability
> gate — it is a real exported workbook value (the DIT-rekey toggle at Deploy
> WLD D215, default `true`, workload-cluster scope only). vSAN Data Services
> gets its own new flag instead (group c). `dit.enabled` stays as a field
> *inside* the revealed Data Services panel.

**(b) Enum-encoded** — toggle maps to an enum value:

| Capability | Field | enable / disable |
|------------|-------|------------------|
| Stretched / AZ2 (`stretched`) | `domain.placement` | enable → `"stretched"` (seed `stretchSiteIds` from the instance's sites if unset); disable → `"local"` (pin `localSiteId` to the first site) |

**(c) New explicit `enabled` boolean** — added only to the objects that are
currently always-rendered with empty data and have no flag today. The new field
is named `enabled` and lives on the object itself (e.g. `cluster.edgeCluster.enabled`),
defaulting to `false`, except the two fleet/instance booleans noted below:

| Capability | New field | Default |
|------------|-----------|---------|
| Identity / AD + SSO (`adsso`) | `fleet.adConfig.enabled` | `false` |
| Backup (SFTP) (`backup`) | `fleet.backupConfig.enabled` | `false` |
| Installer / Depot (`installer`) | `fleet.installerConfig.enabled` | `false` |
| VCF Ops / Automation (`ops`) | `fleet.vcfOpsEnabled` | `true` (see §7) |
| DR / Warm-Standby (`dr`) | `instance.drEnabled` — reveals the existing `drPosture` + `drPairedInstanceId` controls | `false` |
| NSX Edge + T0/BGP (`edge`) | `cluster.edgeCluster.enabled` | `false` |
| NSX Host Overlay (`overlay`) | `cluster.networks.nsxHostOverlay.enabled` | `false` |
| VPC / Transit Gateway (`vpc`) | `cluster.vpcConfig.enabled` | `false` |
| vSAN Data Services (`dataservices`) | `cluster.storage.dataServices.enabled` | `false` |
| Custom Port-groups (`portgroups`) | `cluster.networks.portgroups.enabled` | `false` |
| Advanced (EVC / naming) (`advanced`) | `cluster.advanced.enabled` | `false` |

`ops` defaults to `true` (not `false`) because its appliances ship in the stack
today; defaulting it off would silently change existing designs. See §7.

## 5. Enabled = explicit toggle OR data present

`migrateFleet` backfills every NEW `enabled` boolean to `true` when the object
already holds meaningful data (`hasData(ctx)` is true at migration time), so:

- Existing saved designs keep showing every panel they had configured.
- An imported / environment-scanned design auto-lights the correct chips with
  zero extra wiring — because `hasData` reads the very fields the engine
  already populates on import.

`hasData(ctx)` is defined per capability as "any field deviates from the
factory default." Concrete predicates (illustrative, finalized in the plan):

| Capability | `hasData` true when |
|------------|---------------------|
| `adsso` | any `adConfig` credential/CA/CSR field is non-empty, or `fleet.ssoMode !== "embedded"` |
| `backup` | any `backupConfig` SFTP/passphrase field is non-empty |
| `installer` | any `installerConfig` depot/proxy field is non-empty |
| `ops` | (phase-gated, see §7) |
| `dr` | `instance.drPosture !== "active"` or `instance.drPairedInstanceId != null` |
| `stretched` | `domain.placement === "stretched"` (no separate predicate needed — enum *is* the state) |
| `edge` | any edge node has FQDN/IP, or any T0 uplink/peer is configured |
| `overlay` | `nsxHostOverlay.vlan` set, or any pool/transport-zone name non-empty |
| `vpc` | `vpcConfig` connectivity set or any pool defined |
| `dataservices` | `dedupCompressionEnabled` true, `datastoreName` non-empty, or `nfs.sharePath`/`nfs.serverIp` set (NOT `dit.enabled`, which defaults true) |
| `portgroups` | any portgroup slot has a name or VLAN |
| `advanced` | `advanced.evcSetting` non-empty, `nodeNamePrefix` non-empty, or `internalClusterCidr` differs from `"198.18.0.0/15"` |

Capabilities backed by an **existing** boolean flag (group a) and the
**enum** (group b) need no migration — their state already lives in the model.

## 6. Components

### 6.1 `CAPABILITY_REGISTRY` + helpers (`engine.js`)
- The registry array (declarative, one entry per capability).
- `capabilitiesForScope(scope)` → entries filtered + grouped.
- `isCapabilityEnabled(key, ctx)`, `setCapabilityEnabled(key, ctx, on)` —
  thin dispatchers used by both the UI and tests.
Lives in `engine.js` alongside the other model logic so it is unit-testable
headlessly (Vitest), matching how validators are tested today.

### 6.2 `<CapabilityTray scope ctx onToggle>` (`vcf-design-studio-v9.jsx`)
A compact chip row rendered at the top of each scope's card (Fleet / Instance /
Domain / Cluster), above that scope's panel stack. Renders:
- the scope's **grey core chips** (static list per scope — non-interactive,
  informational; the core panels always render below regardless), then
- the scope's **capability chips** from `capabilitiesForScope`, each colored by
  `isCapabilityEnabled` (teal on / outline off), click → `onToggle(key)`.

Styling matches the studio exactly (verified against the live UI and mockups):
- Inter 600 (`.font-serif`) for any heading; IBM Plex Mono for chip + micro-label text.
- Chip = `font-mono text-[10.5px]`, `px-2 py-0.5 rounded`.
  - off: `border border-slate-300 text-slate-500 bg-white`
  - on: `bg-teal-600 text-white border-teal-600`
  - core: `bg-slate-200 text-slate-600 border-slate-200`
- Micro-label: `text-[10px] uppercase tracking-[0.14em] text-slate-500`.

### 6.3 Panel gating
Each optional panel is wrapped behind the registry rather than its ad-hoc gate:

```jsx
{isCapabilityEnabled('edge', ctx) && <EdgeClusterPanel ... />}
{isCapabilityEnabled('supervisor', ctx) && <SupervisorConfigPanel ... />}
{isCapabilityEnabled('stretched', ctx) && <AZ2HostOverlayPanel ... />}
```

This generalizes the existing scattered gates (`supervisorConfig.enabled &&`,
`placement === "stretched" &&`, `federationEnabled &&`) into one consistent
mechanism. Where a panel currently renders unconditionally (edge, vpc, overlay,
portgroups, advanced), it becomes gated — the behavioral change users see.

### 6.4 Export gating
For "off" to genuinely mean "not in the design" (§8), the export path must
consult the same gate. Each **export-gated** capability's workbook block-builder
(`_edgeAllocationEntries`, `_vpcPoolBlockEntries`, `_portgroupSlotEntries`, the
NSX-overlay and advanced/EVC entries, plus the `adsso`/`backup`/`installer`
fleet blocks) gets a single guard at its top:
`if (!isCapabilityEnabled(key, ctx)) return [];`. Capabilities backed by an
existing flag (supervisor, tiering, federation) and the enum (stretched) already
gate their export via that flag/enum and need no change. This is the only
export-path edit; no cell definitions change, so `verify-cell-map` and M2.1 are
unaffected (a disabled block simply emits no entries for that combo, exactly as
an empty optional block does today).

**`dataservices` is NOT export-gated** (UI-visibility-only, like `ops` in §7).
Its inner `dit.enabled` carries a meaningful always-on default (D215) on workload
clusters that must keep round-tripping; gating it off by default would drop that
default and break M2.1 for fixtures whose data-services block holds only the DIT
toggle. The `dataservices` chip therefore controls panel visibility only; the
underlying fields export exactly as today regardless of the chip. (Phase-2 could
add true export-gating once the D215 default is handled, mirroring `ops`.)

## 7. `ops` (VCF Ops / Automation) — phased

VCF Ops / Automation appliances (`vcfOps`, `vcfOpsCollector`, `vcfOpsLogs`,
`vcfOpsNet*`, `vcfAuto`) are currently part of the appliance-stack sizing
profiles and always deploy. A true off-state must exclude them from the stack
and from sizing math — a larger change that touches `sizeFleet` and the
profile resolver.

**Phase 1 (this spec):** the `ops` chip governs only **panel visibility**
(the VCF Ops configuration panel), gated by a new `fleet.vcfOpsEnabled` boolean
defaulting to `true` (so existing behavior — appliances present — is unchanged).
`hasData` is not used for `ops` in phase 1; it migrates to `true`.

**Phase 2 (deferred, out of scope):** wire `vcfOpsEnabled === false` to exclude
the Ops/Automation appliances from the stack and sizing. Tracked as a follow-up;
explicitly NOT implemented here to avoid coupling progressive disclosure to a
sizing-engine change.

This phasing is called out so the chip's behavior is honest: in phase 1 turning
`ops` off hides the panel but does not yet remove the appliances.

## 8. Disable-with-data is non-destructive

`disable(ctx)` only flips the underlying flag/enum. **Data is kept, just
hidden** — and excluded from export while off, via the export-gating guard in
§6.4 (the block-builder for a disabled capability emits no entries).

If `hasData(ctx)` is true when the user clicks an enabled chip, the toggle first
shows a confirm. The wording depends on whether the capability is export-gated:
- **Export-gated** (edge, vpc, overlay, portgroups, advanced, adsso, backup,
  installer): *"<Capability> has configuration. Hiding it keeps the data but
  excludes it from the design output. Continue?"*
- **Visibility-only** (`ops`, `dataservices`): *"<Capability> has configuration.
  Hiding the panel keeps the data and it still exports. Continue?"*

On confirm → disable. There is **no "clear data" option** (per design
decision) — re-enabling restores the panel exactly as it was. Enabling a
capability never warns.

## 9. Migration

`migrateFleet` additions (idempotent, version-agnostic — these are UI-state
fields, unversioned):
1. For each NEW `enabled` boolean in §4(c): if absent, set it to
   `hasData(ctx)` for that object. (Group a/b capabilities need nothing.)
2. `fleet.vcfOpsEnabled`: if absent, set `true`.
3. `instance.drEnabled`: if absent, set `drPosture !== "active" ||
   drPairedInstanceId != null`.

No cell-map / workbook migration. `verify-cell-map` and the M2.1 round-trip are
unaffected (no new cells).

## 10. Testing

Headless engine tests (`tests/unit/`), matching existing patterns:
- **`capability-registry.test.js`** — for every registry entry:
  `isEnabled` reflects the underlying field; `enable`/`disable` flip it;
  `disable` preserves data (object unchanged except the flag);
  `hasData` true on a populated factory, false on a pristine one.
- **Enum capability** (`stretched`): enable sets `placement="stretched"` and
  seeds `stretchSiteIds`; disable sets `"local"` and pins `localSiteId`.
- **Migration** (`migrate-capabilities.test.js`): a pristine fleet migrates all
  new flags to their defaults (optional caps off, `vcfOpsEnabled` true); a fleet
  with edge/vpc/overlay/portgroups data migrates those flags to `true`; a
  warm-standby instance migrates `drEnabled` to `true`.
- **Component** (`tests/unit/components/`, JSDOM + RTL): `<CapabilityTray>`
  renders core + capability chips for a scope; clicking an off chip calls
  `onToggle`; an enabled chip with data triggers the confirm path.
- **Gating**: a pristine cluster renders none of the optional panels; enabling
  `edge` renders `EdgeClusterPanel`.
- **Export gating** (`capability-export-gating.test.js`): a cluster with edge
  data but `edgeCluster.enabled === false` emits no edge cells; flipping it on
  emits them. Guards the §6.4 / §8 "off → not in design output" contract.

Coverage gate held at current thresholds (95/95/75/90 — branches the soft spot).

## 11. Out of scope / follow-ups
- Phase 2 `ops` sizing exclusion (§7).
- Reveal/collapse animation polish.
- Reordering panels by enable-time (panels keep their fixed order; only
  visibility changes).
- Per-capability help/tooltips beyond the chip label.
