import { describe, it } from "vitest";

// Theme 5a — T0 BGP / uplink UI editors (precursor to #35 export)
//
// Audit (2026-05-22) found that engine.js fully models t0Gateways[].bgpPeers,
// asnLocal, uplinksPerEdge, and bfdEnabled, but vcf-design-studio-v9.jsx
// only exposes haMode, bgpEnabled, stateful, edgeNodeKeys, and
// featureRequirements as editable fields. The BGP peer detail is rendered
// read-only inside T0Diagram (lines ~7558-7589) but never user-entered.
//
// This PR adds the missing input mechanisms so that #35 (export) has
// real data to stamp into Configure Mgmt D156–D184 / Configure WLD D99–D127.
//
// Scope of edits in vcf-design-studio-v9.jsx (T0 editor block ~line 1430):
//   - Local ASN: numeric input on the T0 row (visible when bgpEnabled)
//   - BGP Peers section: collapsible table per T0 with rows for
//       { name, peerIp, peerAsn, mtu, bfdEnabled, password }
//     Add/Remove peer buttons. Password routes through PASSWORD_POLICY
//     (vault path), NOT free-text.
//   - Uplinks per Edge: per-edge-node table for VLAN + IP per uplink slot
//
// Engine-side touch (additive, no behavior change):
//   - PASSWORD_POLICY entry for "t0BgpPeer" credential kind (if missing)
//   - migrateFleet idempotently ensures asnLocal / bgpPeers / uplinksPerEdge
//     exist on legacy fleets (defaults already present in newWorkloadDomain
//     factory — confirm round-trip)
//
// Acceptance:
//   - Adding a BGP peer in the UI mutates t0Gateways[idx].bgpPeers[]
//   - Removing a peer drops the entry without affecting siblings
//   - Editing peer.ip / peer.asn / peer.mtu / peer.bfdEnabled updates the model
//   - Peer password creation routes through PASSWORD_POLICY (vault), not stored plaintext
//   - asnLocal numeric input clamps to valid 16/32-bit ASN range
//   - uplinksPerEdge[] grows/shrinks with the bound edge node count
//   - migrateFleet is idempotent on a fleet with fully populated BGP data
//   - validatePlacementConstraints / sizeCluster unaffected
//   - Workbook export to follow in #35

describe.todo("Theme 5a — T0 BGP / uplink UI editors (TRACKING)");
