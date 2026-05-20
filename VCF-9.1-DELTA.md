# VCF 9.0 → 9.1 Delta

This document captures what changed between VCF 9.0 and VCF 9.1 from the Planning & Preparation Workbook and supporting Broadcom guidance. It serves as the Phase 1 decision artifact for the dual-version studio plan ([Plan 12](#plan-12-vcf-91-support)) and as living documentation alongside the 9.0 research artifacts (`VCF-DEPLOYMENT-PATTERNS.md`, `VCF-NETWORKING-PATTERNS.md`).

**Source workbook:** `vcf-9.1-planning-and-preparation-workbook.xlsx` (Broadcom techdocs)
**Comparison baseline:** Values currently encoded in `engine.js` (sourced from the 9.0 P&P Workbook)
**Verified:** 2026-05-20

---

## Summary table

| Item | 9.0 → 9.1 status | Studio action |
|------|------------------|---------------|
| vCenter storage (5 sizes × 3 profiles) | **CHANGED** — all values reduced | `sizesByVersion["9.1"]` override |
| VCFMS (Control + Worker nodes) | **NEW in 9.1** | Add two appliance defs gated `availableInVersions:["9.1"]` |
| vSAN ESA vs OSA | Now explicitly tracked | Deferred to Plan 13 |
| NSX Manager, NSX Edge, VNA | Unchanged | None |
| SDDC Manager (4 vCPU / 16 GB / 914 GB) | Unchanged | None |
| Identity Broker (WSA) | Unchanged | None |
| VCF Automation / Operations / Ops Proxy / Logs / Net + Collector | Unchanged | None |
| Avi Load Balancer Controller | Unchanged | None |
| Security Services Platform (SSP) | **Unchanged** (verified against R250–R270) | None |
| VRMS, SRM, HVM | Unchanged | None |
| HCX Connector, Ransomware Recovery Connector | Unchanged | None |
| `SIZING_LIMITS` (vCenter R449–R454, NSX R456–R461) | **Unchanged** per-instance | None (5000-host fleet aggregate is new but fleet-level, not per-vCenter) |
| MTU constants (mgmt/vMotion/vSAN/TEP min/TEP rec) | Unchanged | None |
| `NVME_TIER_PARTITION_CAP_GB` (4096) | Unchanged | None |
| vSAN host minimums / FTT policies | Unchanged (Auto-RAID just automates selection) | None |
| Deployment profile shapes (5 profiles) | Same shapes; stacks gain VCFMS | `stackByVersion["9.1"]` override on each profile |

**Net resolver pattern impact:** Only `sizesByVersion` + `stackByVersion` are needed. `SIZING_LIMITS`, MTU constants, partition caps, host minimums, and policy data do NOT need version-keying. Plan 12 design holds as-is.

---

## vCenter storage values (the only sizing delta)

All vCPU and RAM values unchanged. Storage profile values changed across the board:

| Size   | Profile  | 9.0 GB | 9.1 GB | Δ      |
|--------|----------|--------|--------|--------|
| Tiny   | default  |   579  |   604  |   +25  |
| Tiny   | large    |  2019  |  1494  |  −525  |
| Tiny   | xlarge   |  4279  |  2874  | −1405  |
| Small  | default  |   694  |   694  |     0  |
| Small  | large    |  2044  |  1519  |  −525  |
| Small  | xlarge   |  4304  |  2899  | −1405  |
| Medium | default  |   908  |   858  |   −50  |
| Medium | large    |  2208  |  1658  |  −550  |
| Medium | xlarge   |  4468  |  3038  | −1430  |
| Large  | default  |  1358  |  1158  |  −200  |
| Large  | large    |  2258  |  1708  |  −550  |
| Large  | xlarge   |  4518  |  3088  | −1430  |
| XLarge | default  |  2283  |  1783  |  −500  |
| XLarge | large    |  2383  |  1833  |  −550  |
| XLarge | xlarge   |  4643  |  3213  | −1430  |

---

## VCFMS — new in 9.1

VCF 9.1 introduces VCF Management Service (VCFMS), a Kubernetes-based fleet-level control plane. Two new appliance entries:

### VCFMS Control Node

| Size     | vCPU | RAM (GB) | Disk (GB) |
|----------|------|----------|-----------|
| Small    |   4  |    10    |    100    |
| SmallHA  |   4  |    10    |    100    |
| Medium   |   4  |    10    |    100    |
| Large    |   8  |    14    |    100    |

### VCFMS Worker Node

| Size    | Instances | vCPU/each | RAM/each | Disk/each |
|---------|-----------|-----------|----------|-----------|
| Small   |     3     |    12     |    24    |    100    |
| Medium  |     3     |    24     |    48    |    100    |
| Large   |     4     |    24     |    48    |    100    |

### Engine classification decisions

| Field | Value | Source / rationale |
|-------|-------|--------------------|
| `availableInVersions` | `["9.1"]` | Workbook static reference table introduces these only in 9.1 |
| `scope` | `"per-fleet"` | One VCFMS Kubernetes cluster per fleet, deployed on the initial instance (matches existing `fleetMgr` pattern) |
| `placement` | `"per-instance"` | Stamped on the initial instance's mgmt stack; `stackForInstance` filters from non-initial instances via the `scope:"per-fleet"` rule |
| `placementConstraint` | `"mgmt-only-greenfield"` | Matches `fleetMgr` constraint; hooks into `validatePlacementConstraints` |
| DR classification | `DR_REPLICATED_COMPONENTS` | Matches `fleetMgr` (replicated, not backed up). Verified against Broadcom VCF 9.1 fleet-management guidance. |

### VCFMS network requirements (new in 9.1)

Extracted from the 9.1 workbook's "Deploy Mgmt" sheet (rows 116–413) and "Static Reference Tables":

| Requirement | Value |
|-------------|-------|
| Node IP pool | Single **contiguous IPv4 block** on the mgmt VLAN |
| Minimum block size | ~15 IPs (reference example: `10.11.10.31`–`10.11.10.45`) |
| Pool placement | Mgmt VLAN — may reuse ESX mgmt portgroup OR use a dedicated VCF mgmt network (configurable per the workbook's `mgmt_vcf_management_network_chosen` toggle) |
| Kubernetes pod CIDR | `198.18.0.0/15` default (internal, configurable; not user-addressable) |
| VCF Services Runtime FQDN | 1 primary (e.g., `flt-vcfa-sr01.rainpole.io`) — hostname prefix used in node VM names |
| Instance Components FQDN | 1 (e.g., `sfo-ic01.sfo.rainpole.io`) |
| Identity Broker FQDN | 1 (e.g., `flt-idb01.rainpole.io`) |
| DNS | Forward and reverse records required for all node FQDNs |
| NTP | Inherited from vSphere mgmt VLAN (no explicit additional requirement) |
| Load balancer | Internal Kubernetes ingress — does NOT require Avi or external LB |
| Certificates | Framework-managed TLS endpoints for service FQDNs |

**Impact on studio IP planning:** VCFMS introduces a new mgmt-VLAN IP block requirement that's distinct from per-host management IPs. Surfaces in the IP plan only once Plan 13 (or a follow-up) extends `allocateClusterIps` / `createFleetNetworkConfig` to reserve the VCFMS pool. For Plan 12, VCFMS is sized as appliances only; the network-plan integration is deferred.

---

## Items confirmed unchanged (no version-key needed)

### SSP (Security Services Platform)
- **Verified:** Workbook rows R250–R270 + License sub-table R267–R270 match the 9.0 values currently in `engine.js:~306–308`
- Medium = 112 vCPU / 414 GB / 4096 GB; Large = 160 / 606 / 5120; XLarge = 192 / 734 / 6656
- Composite breakdown (1 SSPI + 3 Controllers + 5 Workers @ Medium) yields exactly 112 vCPU and 414 GB
- **Studio action:** none

### SIZING_LIMITS
- **Per-vCenter limits unchanged** (verified workbook R449–R454): Tiny=10/100, Small=100/1000, Medium=400/4000, Large=1000/10000, XLarge=2000/35000
- **NSX limits unchanged** (R456–R461)
- **NEW fleet aggregate ceiling in 9.1:** up to **5000 hosts per fleet** across all instances (2× the previous limit). This is a fleet-level cap, not a per-vCenter cap.
- **Studio action:** none for sizing math. Optional follow-up: surface the 5000-host fleet ceiling as a soft warning in `validateNetworkDesign` or `sizeFleet` (out of scope for Plan 12).

### MTU constants
- `MTU_MGMT = 1500`, `MTU_VMOTION = 9000`, `MTU_VSAN = 9000`, `MTU_TEP_MIN = 1600`, `MTU_TEP_RECOMMENDED = 1700`
- `MTU_TEP_MIN = 1600` is the NSX protocol minimum (TEP overhead headers); 1700 is the recommended optimum — both correct
- **Studio action:** none

### NVMe partition cap
- `NVME_TIER_PARTITION_CAP_GB = 4096`
- Confirmed against VCF 9.1 vSAN ESA documentation
- **Studio action:** none

### vSAN host minimums and FTT policies
- raid5_2p1 minHosts=3, raid5_4p1 minHosts=6, raid6_4p2 minHosts=6 — all valid for 9.1
- Auto-RAID in VCF 9.1 automates FTT selection (3–5 hosts → FTT=1 / RAID-5; 6+ hosts → FTT=2 / RAID-6) but uses the same underlying minimums
- **Studio action:** none. Optional: add a comment noting Auto-RAID in 9.1.

---

## Out of scope for Plan 12

The 9.1 workbook also adds:

- **Private AI Ready Infrastructure** sheet — solution planning module, not core sizing
- **Cloud-Based Ransomware Recovery** expansion — separate solution module
- **Cross Cloud Mobility (HCX)** sheet — HCX-specific solution module
- **Active Directory Inputs** sheet — AD configuration worksheet
- **vSAN ESA vs OSA** explicit tracking — deferred to Plan 13 (needs separate research pass for sizing-math impact: host minimums, partition caps, witness specifics)

These items will be tracked in their own future plans rather than being bundled into the dual-version refactor.

---

## Gate status — Phase 1 → Phase 2

**Decision:** No surprises. The plan's design (only `sizesByVersion` + `stackByVersion` resolvers needed) holds. Phase 2 (write failing tests) can begin.
