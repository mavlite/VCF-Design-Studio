# Brainstorm — Progressive Disclosure / Capability Opt-In (IN PROGRESS)

**Date:** 2026-06-02
**Status:** Brainstorming (visual companion). Direction chosen; scope taxonomy proposed; **awaiting user validation of the taxonomy**. NOT yet specced.
**Resume:** re-read this file, restart the visual companion if needed, re-push the latest mockup, and continue from "Open questions" below.

## The idea (as posed)

The studio has grown complex — each ClusterCard stacks ~20 panels, all shown at once (VPC, DR, NSX overlay, Supervisor, Edge, Federation, AD/SSO, backup…). Goal: **open on the bare-minimum VCF deployment, let users layer in capabilities only when they want them** (progressive disclosure). VPC / DR / NSX underlay / etc. should be opt-in, not always visible.

## Current-state findings (investigation, 2026-06-02)

- **App = 4 tabs** (editor / topology / per-site / network), root `VcfFleetSizer()` (jsx ~7780). Editor is a scrolling tree Sites→Instances→Domains→Clusters; each ClusterCard stacks ~20 collapsible `<Section>` panels, **all rendered at once**.
- **Existing gating seeds (ad-hoc, to be generalized):** `cluster.supervisorConfig.enabled` (per-cluster toggle), `domain.placement === "stretched"` → AZ2 panels, `fleet.federationEnabled` → federation UI, `inst.witnessEnabled`, `cluster.tiering.enabled`, `storage.dataServices.dit.enabled`, version gates (9.0/9.1). **No unifying progressive-disclosure layer; no `fleet.capabilities` object.**
- **Minimum fleet is already lean:** `newFleet()` → 1 site, 1 instance, 1 mgmt domain, 1 mgmt cluster (+ appliance stack + empty networks). Everything else (workload domains, edge, supervisor, VPC, DR, federation) is empty-by-default but **always shown**. So the gap is purely UI surfacing + recording opt-in state.
- **Styling to match (mockups + real UI):** bg `#f8fafc`; **Inter** (`font-serif`, weight 600) for titles; **IBM Plex Mono** (`font-mono`) for labels; micro-labels `text-[10px] uppercase tracking-[0.14em] text-slate-500`; white panels, `border border-slate-200 rounded`; accent-on-hover (teal/indigo/violet/amber/rose); Tailwind CDN.

## Decision so far

**Direction: Option A — "Capability Tray"** (chosen by user over B "+Add Capability" picker and C "Complexity Tiers"). A persistent row of capability chips; off by default; toggling one on reveals its panel(s) inline. One control surface to see & flip everything.

**Refinement proposed (awaiting validation): a SCOPE-AWARE tray** — a tray at each scope, because capabilities live at different model scopes:
- **Fleet scope** — always-on core: DNS/NTP, Naming, Report. Capabilities: Identity/AD+SSO, Backup (SFTP), Installer/Depot, NSX Federation, VCF Ops/Automation.
- **Instance scope** — capabilities: DR/Warm-Standby, + Workload Domain.
- **Domain scope** — capabilities: Stretched/AZ2 (= `placement`).
- **Cluster scope** — always-on core: Host & Sizing, Storage (vSAN), Networking (VLAN/MTU/pools), Appliance Stack. Capabilities: NSX Edge+T0/BGP, NSX Host Overlay, Supervisor/VKS, VPC/TGW, NVMe Tiering, vSAN Data Services, Custom Port-groups, Advanced (EVC/naming).

Visual rules: grey chip = always-on core (never hidden); teal = enabled (panel revealed); outline = available/off. Generalize the existing scattered enablers into one per-scope tray system. A capability with data filled in can't be silently turned off (warn).

## Taxonomy validation — RESOLVED (2026-06-02)

User answered the three open judgment calls:
1. **AD/SSO** → **opt-in capability** (stays in fleet tray, off by default). Bare-minimum first screen stays minimal; SDDC Manager local admin covers day-0.
2. **"+ Workload Domain"** → **plain `+ Add` action**, NOT a capability chip. Adding a WLD is a structural tree action (like add-cluster/add-site), not an on/off reveal. REMOVE it from the instance capability tray. → Instance scope's only capability is **DR/Warm-Standby**.
3. **vSAN Data Services / NVMe Tiering** → **top-level cluster chips** (parallel to Edge/Supervisor/VPC). Every opt-in feature visible in one tray at the same level.

**→ Taxonomy is now LOCKED.** Next: model design + visual detail (below), then spec.

## Remaining design questions (resume here)

5. **Model**: where to store opt-in state. Leaning registry-driven (a capability registry: key → {scope, isEnabled, enable, disable, hasData, panel}) delegating to NATURAL model state — reuse existing flags where present (supervisorConfig.enabled, federationEnabled, tiering.enabled, dataServices.dit.enabled, placement==="stretched"), add a new explicit `enabled` boolean ONLY for capabilities that lack one today (edge, vpc, hostOverlay, portgroups — currently always-rendered with possibly-empty data). "Enabled" = explicit toggle on OR data present → import/round-trip lights the right chips for free; no parallel state to drift. Pure UI-state concern, NO workbook/M2.1 cells.
6. **Visual detail** of the tray (placement, on/off affordance, reveal/collapse, "data present" lock/warn on disable).

## After the taxonomy is validated
Model design → write spec to `docs/superpowers/specs/` → writing-plans → implement (likely: a capabilities model + a `<CapabilityTray>` component + gate the existing panels behind it, generalizing supervisorConfig.enabled / placement / federationEnabled).

## Visual companion session
- Mockups live in `.superpowers/brainstorm/` (gitignored): `disclosure-directions.html` (the 3 directions), `capability-tray-scoped.html` (the scope taxonomy — latest).
- Server auto-exits on inactivity → restart with `scripts/start-server.sh --project-dir <repo>` (run_in_background on Windows), read new `state/server-info` for the new port, copy the latest mockup into the new session's `content/` dir, give user the new URL.
