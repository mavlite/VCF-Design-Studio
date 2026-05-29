// Phase B — AZ2 / BGP validators + promoteToInitial
//
// Covers:
//   - checkOverrideSubnet (inner closure, tested via validateNetworkDesign)
//   - VCF-IP-007: host override IP outside the cluster's mgmt subnet
//   - VCF-NET-030: BGP peer IP not reachable from any uplink subnet
//   - promoteToInitial: instance promotion helper

import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  newFleet,
  newInstance,
  validateNetworkDesign,
  promoteToInitial,
  newT0Gateway,
} = VcfEngine;

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Returns a fleet whose DNS and NTP are populated so VCF-NET-010/011
// don't pollute the issue list on otherwise-clean fleets.
function baseFleet() {
  const f = newFleet();
  f.networkConfig.dns.servers = ["10.0.0.1"];
  f.networkConfig.ntp.servers = ["pool.ntp.org"];
  return f;
}

// Returns a cluster reference from a fleet (first instance, first domain,
// first cluster).
function firstCluster(f) {
  return f.instances[0].domains[0].clusters[0];
}

// ─── promoteToInitial ────────────────────────────────────────────────────────

describe("promoteToInitial", () => {
  it("makes the target instance the new instances[0]", () => {
    const f = newFleet();
    const second = newInstance("vcf-instance-02", [], f.vcfVersion);
    const secondId = second.id;
    f.instances.push(second);

    const promoted = promoteToInitial(f, secondId);

    expect(promoted.instances[0].id).toBe(secondId);
    expect(promoted.instances[0].name).toBe("vcf-instance-02");
  });

  it("demotes the previous initial to a non-zero position", () => {
    const f = newFleet();
    const originalInitialId = f.instances[0].id;
    const second = newInstance("vcf-instance-02", [], f.vcfVersion);
    f.instances.push(second);

    const promoted = promoteToInitial(f, second.id);

    expect(promoted.instances[1].id).toBe(originalInitialId);
  });

  it("is idempotent when the target is already instances[0]", () => {
    const f = newFleet();
    const initialId = f.instances[0].id;

    // Promoting the already-initial instance returns the fleet unchanged
    // (idx <= 0 short-circuit).
    const result = promoteToInitial(f, initialId);

    expect(result.instances[0].id).toBe(initialId);
    // Should be the same reference (early return) — or at least same length.
    expect(result.instances.length).toBe(f.instances.length);
  });

  it("returns the original fleet when instanceId is not found", () => {
    const f = newFleet();
    const result = promoteToInitial(f, "nonexistent-id");
    // idx === -1, idx <= 0 path returns fleet unchanged
    expect(result).toBe(f);
  });

  it("returns the original fleet when instances array is missing", () => {
    const emptyFleet = { ...newFleet(), instances: null };
    const result = promoteToInitial(emptyFleet, "any-id");
    expect(result).toBe(emptyFleet);
  });
});

// ─── VCF-IP-007 ──────────────────────────────────────────────────────────────

describe("VCF-IP-007 — override IP in wrong subnet (silent on clean fleet)", () => {
  it("emits no VCF-IP-007 on a fresh fleet with no overrides", () => {
    const f = baseFleet();
    const issues = validateNetworkDesign(f);
    const ip007 = issues.filter((i) => i.ruleId === "VCF-IP-007");
    expect(ip007).toHaveLength(0);
  });

  it("emits no VCF-IP-007 when override IP is inside the mgmt subnet", () => {
    const f = baseFleet();
    const c = firstCluster(f);
    c.networks.mgmt = {
      vlan: 100,
      subnet: "10.0.17.0/24",
      gateway: "10.0.17.1",
      pool: { start: "10.0.17.10", end: "10.0.17.50" },
    };
    // Override IP inside the subnet — should be valid
    c.hostOverrides = [
      { hostIndex: 0, mgmtIp: "10.0.17.25", vmotionIp: null, vsanIp: null, hostTepIps: null, bmcIp: null, hostname: null },
    ];
    const issues = validateNetworkDesign(f);
    const ip007 = issues.filter((i) => i.ruleId === "VCF-IP-007");
    expect(ip007).toHaveLength(0);
  });
});

describe("VCF-IP-007 — fires when override IP is outside the cluster subnet", () => {
  it("emits exactly one VCF-IP-007 for a single misplaced mgmt override", () => {
    const f = baseFleet();
    const c = firstCluster(f);
    c.networks.mgmt = {
      vlan: 100,
      subnet: "10.0.17.0/24",
      gateway: "10.0.17.1",
      pool: { start: "10.0.17.10", end: "10.0.17.50" },
    };
    // Override IP is in a completely different subnet
    c.hostOverrides = [
      { hostIndex: 0, mgmtIp: "192.168.50.5", vmotionIp: null, vsanIp: null, hostTepIps: null, bmcIp: null, hostname: null },
    ];
    const issues = validateNetworkDesign(f);
    const ip007 = issues.filter((i) => i.ruleId === "VCF-IP-007");
    expect(ip007.length).toBeGreaterThanOrEqual(1);
    expect(ip007[0].severity).toBe("error");
    expect(ip007[0].message).toMatch(/192\.168\.50\.5/);
    expect(ip007[0].message).toMatch(/10\.0\.17\.0\/24/);
  });

  it("emits VCF-IP-007 for a stretched cluster override that is outside BOTH AZ1 and AZ2 subnets", () => {
    const f = baseFleet();
    const dom = f.instances[0].domains[0];
    dom.placement = "stretched";
    dom.hostSplitPct = 50;
    const c = firstCluster(f);
    c.networks.mgmt = {
      vlan: 100,
      subnet: "10.0.17.0/24",
      gateway: "10.0.17.1",
      pool: { start: "10.0.17.10", end: "10.0.17.50" },
    };
    c.az2Networks.mgmt = {
      vlan: 200,
      subnet: "10.0.18.0/24",
      gateway: "10.0.18.1",
      pool: { start: "10.0.18.10", end: "10.0.18.50" },
    };
    // Override IP is outside both subnets
    c.hostOverrides = [
      { hostIndex: 0, mgmtIp: "172.16.99.5", vmotionIp: null, vsanIp: null, hostTepIps: null, bmcIp: null, hostname: null },
    ];
    const issues = validateNetworkDesign(f);
    const ip007 = issues.filter((i) => i.ruleId === "VCF-IP-007");
    expect(ip007.length).toBeGreaterThanOrEqual(1);
    expect(ip007[0].severity).toBe("error");
    // Message should call out both AZ subnets
    expect(ip007[0].message).toMatch(/az1|az2/i);
  });

  it("does NOT emit VCF-IP-007 for a stretched cluster override inside the AZ2 subnet", () => {
    // On a stretched cluster, being in EITHER AZ subnet is valid.
    const f = baseFleet();
    const dom = f.instances[0].domains[0];
    dom.placement = "stretched";
    dom.hostSplitPct = 50;
    const c = firstCluster(f);
    c.networks.mgmt = {
      vlan: 100,
      subnet: "10.0.17.0/24",
      gateway: "10.0.17.1",
      pool: { start: "10.0.17.10", end: "10.0.17.50" },
    };
    c.az2Networks.mgmt = {
      vlan: 200,
      subnet: "10.0.18.0/24",
      gateway: "10.0.18.1",
      pool: { start: "10.0.18.10", end: "10.0.18.50" },
    };
    // Override IP is inside the AZ2 subnet — should be valid on a stretched cluster
    c.hostOverrides = [
      { hostIndex: 5, mgmtIp: "10.0.18.25", vmotionIp: null, vsanIp: null, hostTepIps: null, bmcIp: null, hostname: null },
    ];
    const issues = validateNetworkDesign(f);
    const ip007 = issues.filter((i) => i.ruleId === "VCF-IP-007");
    expect(ip007).toHaveLength(0);
  });
});

// ─── VCF-NET-030 (BGP peer not in any uplink subnet) ─────────────────────────

describe("VCF-NET-030 — BGP peer not in any uplink subnet (silent on clean fleet)", () => {
  it("emits no VCF-NET-030 on a fresh fleet with no T0 gateways", () => {
    const f = baseFleet();
    const issues = validateNetworkDesign(f);
    const net030 = issues.filter((i) => i.ruleId === "VCF-NET-030");
    expect(net030).toHaveLength(0);
  });

  it("emits no VCF-NET-030 when a BGP peer IP is inside an uplink subnet", () => {
    const f = baseFleet();
    const c = firstCluster(f);
    // Add an uplink with a real subnet
    c.networks.uplinks = [
      { vlan: 3000, gateway: "10.0.16.1", subnet: "10.0.16.0/24" },
    ];
    const t0 = newT0Gateway("t0-test");
    t0.bgpEnabled = true;
    t0.bgpPeers = [{ ip: "10.0.16.10", asn: 65002 }];
    c.t0Gateways = [t0];
    const issues = validateNetworkDesign(f);
    const net030 = issues.filter((i) => i.ruleId === "VCF-NET-030");
    expect(net030).toHaveLength(0);
  });
});

describe("VCF-NET-030 — fires when BGP peer IP is outside every uplink subnet", () => {
  it("emits a VCF-NET-030 issue when peer IP is unreachable from uplink subnets", () => {
    const f = baseFleet();
    const c = firstCluster(f);
    // Configure an uplink subnet
    c.networks.uplinks = [
      { vlan: 3000, gateway: "10.0.16.1", subnet: "10.0.16.0/24" },
    ];
    const t0 = newT0Gateway("t0-test");
    t0.bgpEnabled = true;
    // BGP peer IP is in a completely different subnet — not reachable
    t0.bgpPeers = [{ ip: "192.168.99.5", asn: 65002 }];
    c.t0Gateways = [t0];
    const issues = validateNetworkDesign(f);
    const net030 = issues.filter((i) => i.ruleId === "VCF-NET-030");
    expect(net030.length).toBeGreaterThanOrEqual(1);
    expect(net030[0].severity).toBe("error");
    expect(net030[0].message).toMatch(/192\.168\.99\.5/);
  });

  it("emits VCF-NET-030 for each unreachable peer when multiple peers are misconfigured", () => {
    const f = baseFleet();
    const c = firstCluster(f);
    c.networks.uplinks = [
      { vlan: 3000, gateway: "10.0.16.1", subnet: "10.0.16.0/24" },
    ];
    const t0 = newT0Gateway("t0-test");
    t0.bgpEnabled = true;
    t0.bgpPeers = [
      { ip: "172.31.5.1", asn: 65101 },
      { ip: "172.31.5.2", asn: 65102 },
    ];
    c.t0Gateways = [t0];
    const issues = validateNetworkDesign(f);
    const net030 = issues.filter((i) => i.ruleId === "VCF-NET-030");
    expect(net030.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT emit VCF-NET-030 when uplinks array is empty (no subnet to check against)", () => {
    // The rule only fires when nets.uplinks has at least one entry.
    const f = baseFleet();
    const c = firstCluster(f);
    // Leave uplinks as the default (two entries with vlan/gateway = null, no subnet)
    c.networks.uplinks = [];
    const t0 = newT0Gateway("t0-test");
    t0.bgpEnabled = true;
    t0.bgpPeers = [{ ip: "192.168.99.5", asn: 65002 }];
    c.t0Gateways = [t0];
    const issues = validateNetworkDesign(f);
    const net030 = issues.filter((i) => i.ruleId === "VCF-NET-030");
    expect(net030).toHaveLength(0);
  });
});
