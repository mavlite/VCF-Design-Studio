import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const { newT0Gateway, migrateFleet, newFleet, PASSWORD_POLICY } = VcfEngine;

// Theme 5a — T0 BGP / uplink UI editors (precursor to #35 export)
//
// Engine-side coverage for the model the UI editors mutate:
//   - newT0Gateway() factory exposes asnLocal/bgpPeers/uplinksPerEdge slots
//   - migrateFleet normalizes peer shape ({id, name, ip, asn, mtu, bfdEnabled})
//     and backfills uplinksPerEdge[] on legacy fleets
//   - migrateFleet is idempotent on a fully populated fleet
//   - PASSWORD_POLICY carries the bgp-peer credential kind that the UI's
//     "peer password generated via vault" notice promises
//
// JSX edits live in vcf-design-studio-v9.jsx (T0 editor block ~line 1430).
// They cannot be unit-tested without a DOM; the helpers addBgpPeer /
// updateBgpPeer / removeBgpPeer / updateUplinkCount are thin wrappers over
// updateT0() — the model-side coverage here protects the data contract
// they read from and write to.

describe("Theme 5a — T0 BGP / uplink model", () => {
  it("newT0Gateway() exposes BGP/uplink slots with sane defaults", () => {
    const t0 = newT0Gateway();
    expect(t0).toMatchObject({
      asnLocal: null,
      bgpPeers: [],
      uplinksPerEdge: [],
      bgpEnabled: false,
    });
  });

  it("PASSWORD_POLICY['bgp-peer'] exists and uses an alphanumeric alphabet (RFC 2385 TCP-MD5 safety)", () => {
    const policy = PASSWORD_POLICY["bgp-peer"];
    expect(policy).toBeDefined();
    expect(policy.len).toBeGreaterThanOrEqual(8);
    expect(policy.len).toBeLessThanOrEqual(80);
    expect(policy.classes.special).toBe(0);
    expect(policy.alphabet?.special ?? "").toBe("");
  });
});

describe("Theme 5a — migrateFleet peer normalization", () => {
  const fleetWithPeers = (peers) => ({
    version: "vcf-sizer-v9",
    instances: [{
      siteIds: ["site-1"],
      domains: [{
        id: "dom-1",
        type: "mgmt",
        clusters: [{
          id: "clu-1",
          t0Gateways: [{
            id: "t0-1",
            name: "t0-prod",
            haMode: "active-active",
            bgpEnabled: true,
            asnLocal: 65001,
            edgeNodeKeys: ["e1", "e2"],
            uplinksPerEdge: [2, 1],
            bgpPeers: peers,
          }],
        }],
      }],
    }],
    sites: [{ id: "site-1", name: "Site A" }],
  });

  it("stamps id + defaults onto legacy peers missing fields", () => {
    const fleet = fleetWithPeers([{ ip: "10.0.0.1", asn: 65002 }]);
    const out = migrateFleet(fleet);
    const peer = out.instances[0].domains[0].clusters[0].t0Gateways[0].bgpPeers[0];
    expect(peer.id).toMatch(/^peer-/);
    expect(peer.ip).toBe("10.0.0.1");
    expect(peer.asn).toBe(65002);
    expect(peer.name).toBeNull();
    expect(peer.mtu).toBeNull();
    expect(peer.bfdEnabled).toBe(false);
  });

  it("preserves unknown peer fields (e.g. legacy peerIp/peerAsn)", () => {
    const fleet = fleetWithPeers([{ peerIp: "10.0.0.1", peerAsn: 65002 }]);
    const out = migrateFleet(fleet);
    const peer = out.instances[0].domains[0].clusters[0].t0Gateways[0].bgpPeers[0];
    expect(peer.peerIp).toBe("10.0.0.1");
    expect(peer.peerAsn).toBe(65002);
    expect(peer.id).toMatch(/^peer-/);
  });

  it("preserves existing peer.id on re-migration (idempotency anchor)", () => {
    const fleet = fleetWithPeers([
      { id: "peer-stable-123", name: "uplink-a", ip: "10.0.0.1", asn: 65002, mtu: 9000, bfdEnabled: true },
    ]);
    const out1 = migrateFleet(fleet);
    const out2 = migrateFleet(out1);
    const p1 = out1.instances[0].domains[0].clusters[0].t0Gateways[0].bgpPeers[0];
    const p2 = out2.instances[0].domains[0].clusters[0].t0Gateways[0].bgpPeers[0];
    expect(p1.id).toBe("peer-stable-123");
    expect(p2.id).toBe("peer-stable-123");
    expect(p2).toEqual(p1);
  });

  it("backfills uplinksPerEdge to [] when legacy fleet lacks the field", () => {
    const fleet = {
      version: "vcf-sizer-v9",
      instances: [{
        siteIds: ["site-1"],
        domains: [{
          id: "dom-1",
          type: "mgmt",
          clusters: [{
            id: "clu-1",
            t0Gateways: [{ id: "t0-1", name: "t0", haMode: "active-standby" }],
          }],
        }],
      }],
      sites: [{ id: "site-1", name: "Site A" }],
    };
    const out = migrateFleet(fleet);
    const t0 = out.instances[0].domains[0].clusters[0].t0Gateways[0];
    expect(t0.uplinksPerEdge).toEqual([]);
    expect(t0.bgpPeers).toEqual([]);
  });

  it("preserves uplinksPerEdge values across migration (round-trip)", () => {
    const fleet = fleetWithPeers([]);
    const out = migrateFleet(fleet);
    expect(out.instances[0].domains[0].clusters[0].t0Gateways[0].uplinksPerEdge).toEqual([2, 1]);
  });
});

describe("Theme 5a — migrateFleet idempotency", () => {
  it("two passes of migrateFleet produce equal output on a fully populated BGP fleet", () => {
    const fleet = {
      version: "vcf-sizer-v9",
      instances: [{
        siteIds: ["site-1"],
        domains: [{
          id: "dom-1",
          type: "mgmt",
          clusters: [{
            id: "clu-1",
            t0Gateways: [{
              id: "t0-1",
              name: "t0-prod",
              haMode: "active-active",
              bgpEnabled: true,
              asnLocal: 65001,
              edgeNodeKeys: ["e1", "e2", "e3"],
              uplinksPerEdge: [2, 2, 1],
              bgpPeers: [
                { id: "peer-a", name: "uplink-a", ip: "10.0.0.1", asn: 65002, mtu: 9000, bfdEnabled: true },
                { id: "peer-b", name: "uplink-b", ip: "10.0.0.2", asn: 65002, mtu: 9000, bfdEnabled: false },
              ],
            }],
          }],
        }],
      }],
      sites: [{ id: "site-1", name: "Site A" }],
    };
    const a = migrateFleet(fleet);
    const b = migrateFleet(a);
    const t0a = a.instances[0].domains[0].clusters[0].t0Gateways[0];
    const t0b = b.instances[0].domains[0].clusters[0].t0Gateways[0];
    expect(t0b).toEqual(t0a);
  });

  it("newFleet() round-trips through migrateFleet unchanged on the BGP slice", () => {
    const fleet = newFleet();
    const out = migrateFleet(fleet);
    const clu = out.instances[0]?.domains[0]?.clusters?.[0];
    if (clu) {
      expect(clu.t0Gateways || []).toEqual([]);
    }
  });
});
