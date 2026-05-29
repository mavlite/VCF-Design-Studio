// @vitest-environment node
//
// Task-31 Phase B — IP allocator coverage.
// Focuses on the AZ2 stretched-cluster host-split path that was not reached
// by the original ip-allocator.test.js suite. The non-stretched (AZ1-only)
// path is exercised here only for the behaviors that differ from the pre-
// existing suite: the `az: null` tag and the plain (non-prefixed) exhaustion
// warning text.
//
// Key source facts verified before writing:
//   ipToInt(ip)  — ((o0 << 24) | (o1 << 16) | (o2 << 8) | o3) >>> 0
//   intToIp(n)   — joins the four bytes with "."
//   allocateClusterIps(cluster, finalHosts, ctx)
//     isStretched = ctx.domain.placement === "stretched" && cluster.az2Networks
//     splitPct    = domain.hostSplitPct ?? 50
//     az1Count    = Math.ceil(finalHosts * splitPct / 100)   ← CEIL
//     az2Count    = finalHosts - az1Count
//     az tag      = isStretched ? ("az1" | "az2") : null
//     pool-exhaustion warning networkName prefixes:
//       non-stretched → "mgmt", "vmotion", "vsan", …
//       stretched     → "az1/mgmt", "az2/mgmt", …

import { describe, it, expect } from "vitest";
import * as engine from "../../engine.js";

// ─── ipToInt / intToIp ────────────────────────────────────────────────────────

describe("ipToInt / intToIp", () => {
  it("round-trips a typical address", () => {
    expect(engine.intToIp(engine.ipToInt("10.0.16.1"))).toBe("10.0.16.1");
  });

  it("boundary: 0.0.0.0 → 0", () => {
    expect(engine.ipToInt("0.0.0.0")).toBe(0);
    expect(engine.intToIp(0)).toBe("0.0.0.0");
  });

  it("boundary: 255.255.255.255 → 0xffffffff", () => {
    expect(engine.ipToInt("255.255.255.255")).toBe(0xffffffff);
    expect(engine.intToIp(0xffffffff)).toBe("255.255.255.255");
  });

  it("converts a representative middle value — 10.0.0.16 = 0x0a000010", () => {
    expect(engine.ipToInt("10.0.0.16")).toBe(0x0a000010);
    expect(engine.intToIp(0x0a000010)).toBe("10.0.0.16");
  });

  it("each octet is independent — 1.2.3.4", () => {
    // 0x01020304 = 16909060
    expect(engine.ipToInt("1.2.3.4")).toBe(0x01020304);
    expect(engine.intToIp(0x01020304)).toBe("1.2.3.4");
  });
});

// ─── AZ1-only (non-stretched) ─────────────────────────────────────────────────

function makeAz1Cluster() {
  // Minimal cluster fixture with populated AZ1 pools.
  return {
    id: "cl-az1-test",
    networks: {
      mgmt:    { pool: { start: "10.1.0.10", end: "10.1.0.30" } },
      vmotion: { pool: { start: "10.1.1.10", end: "10.1.1.30" } },
      vsan:    { pool: { start: "10.1.2.10", end: "10.1.2.30" } },
      hostTep: { pool: { start: "10.1.3.10", end: "10.1.3.60" }, useDhcp: false },
      edgeTep: { pool: { start: null, end: null } },
    },
    az2Networks: null,
    t0Gateways: [],
    hostOverrides: [],
  };
}

describe("allocateClusterIps — AZ1-only (non-stretched)", () => {
  it("allocates the requested number of hosts", () => {
    const result = engine.allocateClusterIps(makeAz1Cluster(), 4);
    expect(result.hosts).toHaveLength(4);
  });

  it("tags every host with az: null (not stretched)", () => {
    const result = engine.allocateClusterIps(makeAz1Cluster(), 3);
    result.hosts.forEach((h) => expect(h.az).toBeNull());
  });

  it("mgmt IPs are sequential from pool.start", () => {
    const result = engine.allocateClusterIps(makeAz1Cluster(), 3);
    expect(result.hosts[0].mgmtIp).toBe("10.1.0.10");
    expect(result.hosts[1].mgmtIp).toBe("10.1.0.11");
    expect(result.hosts[2].mgmtIp).toBe("10.1.0.12");
  });

  it("emits pool-exhaustion warning with plain (non-prefixed) network name", () => {
    const cluster = makeAz1Cluster();
    // Tiny pool: only 2 IPs, request 5.
    cluster.networks.mgmt.pool = { start: "10.1.0.10", end: "10.1.0.11" };
    const result = engine.allocateClusterIps(cluster, 5);
    const w = result.warnings.find((x) => x.ruleId === "VCF-IP-002");
    expect(w).toBeDefined();
    // Non-stretched: networkName is "mgmt", NOT "az1/mgmt".
    expect(w.message).toMatch(/^mgmt pool exhausted/);
    expect(w.message).not.toMatch(/az1\//);
  });
});

// ─── AZ2 split (stretched) ────────────────────────────────────────────────────

function makeStretchedCluster(opts = {}) {
  // opts: { az1PoolSize, az2PoolSize }  — how many IPs each AZ pool has
  const az1Size = opts.az1PoolSize ?? 20;
  const az2Size = opts.az2PoolSize ?? 20;

  // Build end address by offsetting start. Pools start at .10, so end = .10 + size - 1
  function poolEnd(base, size) {
    const n = engine.ipToInt(base) + size - 1;
    return engine.intToIp(n);
  }

  return {
    id: "cl-stretched-test",
    networks: {
      mgmt:    { pool: { start: "10.2.0.10", end: poolEnd("10.2.0.10", az1Size) } },
      vmotion: { pool: { start: "10.2.1.10", end: poolEnd("10.2.1.10", az1Size) } },
      vsan:    { pool: { start: "10.2.2.10", end: poolEnd("10.2.2.10", az1Size) } },
      hostTep: { pool: { start: "10.2.3.10", end: poolEnd("10.2.3.10", az1Size * 2) }, useDhcp: false },
      edgeTep: { pool: { start: null, end: null } },
    },
    az2Networks: {
      mgmt:    { pool: { start: "10.3.0.10", end: poolEnd("10.3.0.10", az2Size) } },
      vmotion: { pool: { start: "10.3.1.10", end: poolEnd("10.3.1.10", az2Size) } },
      vsan:    { pool: { start: "10.3.2.10", end: poolEnd("10.3.2.10", az2Size) } },
      hostTep: { pool: { start: "10.3.3.10", end: poolEnd("10.3.3.10", az2Size * 2) }, useDhcp: false },
    },
    t0Gateways: [],
    hostOverrides: [],
  };
}

function stretchedCtx(hostSplitPct) {
  // ctx carries domain.placement + optional hostSplitPct.
  const domain = { placement: "stretched" };
  if (typeof hostSplitPct === "number") domain.hostSplitPct = hostSplitPct;
  return { domain };
}

describe("allocateClusterIps — AZ2 split (stretched)", () => {
  it("splits 8 hosts 4/4 with default hostSplitPct=50", () => {
    // az1Count = Math.ceil(8 * 50 / 100) = 4
    // az2Count = 8 - 4 = 4
    const result = engine.allocateClusterIps(makeStretchedCluster(), 8, stretchedCtx());
    const az1 = result.hosts.filter((h) => h.az === "az1");
    const az2 = result.hosts.filter((h) => h.az === "az2");
    expect(az1).toHaveLength(4);
    expect(az2).toHaveLength(4);
    expect(result.hosts).toHaveLength(8);
  });

  it("AZ1 hosts get IPs from AZ1 (10.2.x) pools", () => {
    const result = engine.allocateClusterIps(makeStretchedCluster(), 8, stretchedCtx());
    const az1 = result.hosts.filter((h) => h.az === "az1");
    az1.forEach((h) => {
      expect(h.mgmtIp).toMatch(/^10\.2\.0\./);
      expect(h.vmotionIp).toMatch(/^10\.2\.1\./);
      expect(h.vsanIp).toMatch(/^10\.2\.2\./);
    });
  });

  it("AZ2 hosts get IPs from AZ2 (10.3.x) pools", () => {
    const result = engine.allocateClusterIps(makeStretchedCluster(), 8, stretchedCtx());
    const az2 = result.hosts.filter((h) => h.az === "az2");
    az2.forEach((h) => {
      expect(h.mgmtIp).toMatch(/^10\.3\.0\./);
      expect(h.vmotionIp).toMatch(/^10\.3\.1\./);
      expect(h.vsanIp).toMatch(/^10\.3\.2\./);
    });
  });

  it("respects hostSplitPct=25 → az1Count=2, az2Count=6 (8 hosts)", () => {
    // az1Count = Math.ceil(8 * 25 / 100) = Math.ceil(2) = 2
    // az2Count = 8 - 2 = 6
    const result = engine.allocateClusterIps(makeStretchedCluster(), 8, stretchedCtx(25));
    const az1 = result.hosts.filter((h) => h.az === "az1");
    const az2 = result.hosts.filter((h) => h.az === "az2");
    expect(az1).toHaveLength(2);
    expect(az2).toHaveLength(6);
  });

  it("respects hostSplitPct=75 → az1Count=6, az2Count=2 (8 hosts)", () => {
    // az1Count = Math.ceil(8 * 75 / 100) = Math.ceil(6) = 6
    // az2Count = 8 - 6 = 2
    const result = engine.allocateClusterIps(makeStretchedCluster(), 8, stretchedCtx(75));
    const az1 = result.hosts.filter((h) => h.az === "az1");
    const az2 = result.hosts.filter((h) => h.az === "az2");
    expect(az1).toHaveLength(6);
    expect(az2).toHaveLength(2);
  });

  it("AZ1 and AZ2 mgmt IPs are sequential from their respective pool starts", () => {
    const result = engine.allocateClusterIps(makeStretchedCluster(), 6, stretchedCtx());
    // default 50%: az1Count=3, az2Count=3
    const az1 = result.hosts.filter((h) => h.az === "az1");
    const az2 = result.hosts.filter((h) => h.az === "az2");
    expect(az1[0].mgmtIp).toBe("10.2.0.10");
    expect(az1[1].mgmtIp).toBe("10.2.0.11");
    expect(az1[2].mgmtIp).toBe("10.2.0.12");
    expect(az2[0].mgmtIp).toBe("10.3.0.10");
    expect(az2[1].mgmtIp).toBe("10.3.0.11");
    expect(az2[2].mgmtIp).toBe("10.3.0.12");
  });

  it("AZ2 hosts use independent index cursors — AZ2 cursor starts at 0", () => {
    // With 8 hosts split 4/4, the first AZ2 host (index 4) should get
    // the first IP from the AZ2 pool, not the 5th.
    const result = engine.allocateClusterIps(makeStretchedCluster(), 8, stretchedCtx());
    const hostIdx4 = result.hosts[4]; // first AZ2 host
    expect(hostIdx4.az).toBe("az2");
    expect(hostIdx4.mgmtIp).toBe("10.3.0.10"); // cursor reset to 0 for AZ2
  });

  it("non-stretched ctx makes all hosts az: null even if az2Networks is present", () => {
    const cluster = makeStretchedCluster();
    // Pass ctx without stretched placement.
    const ctx = { domain: { placement: "standard" } };
    const result = engine.allocateClusterIps(cluster, 4, ctx);
    result.hosts.forEach((h) => expect(h.az).toBeNull());
  });

  it("pool-exhaustion warning for AZ2 pool uses 'az2/' prefix in networkName", () => {
    // Tiny AZ2 pool — only 1 IP, need 4.
    const cluster = makeStretchedCluster({ az1PoolSize: 20, az2PoolSize: 1 });
    const result = engine.allocateClusterIps(cluster, 8, stretchedCtx()); // 4 AZ1, 4 AZ2
    const az2Warn = result.warnings.find(
      (w) => w.ruleId === "VCF-IP-002" && w.message.includes("az2/")
    );
    expect(az2Warn).toBeDefined();
    expect(az2Warn.message).toMatch(/^az2\/mgmt pool exhausted/);
  });

  it("pool-exhaustion warning for AZ1 pool uses 'az1/' prefix when stretched", () => {
    // Tiny AZ1 pool — only 1 IP, need 4.
    const cluster = makeStretchedCluster({ az1PoolSize: 1, az2PoolSize: 20 });
    const result = engine.allocateClusterIps(cluster, 8, stretchedCtx()); // 4 AZ1, 4 AZ2
    const az1Warn = result.warnings.find(
      (w) => w.ruleId === "VCF-IP-002" && w.message.includes("az1/")
    );
    expect(az1Warn).toBeDefined();
    expect(az1Warn.message).toMatch(/^az1\/mgmt pool exhausted/);
  });

  it("AZ2 DHCP hostTep emits az2/ prefixed VCF-IP-019 warning", () => {
    const cluster = makeStretchedCluster();
    cluster.az2Networks.hostTep.useDhcp = true;
    const result = engine.allocateClusterIps(cluster, 4, stretchedCtx());
    const dhcpWarn = result.warnings.find(
      (w) => w.ruleId === "VCF-IP-019" && w.message.includes("az2/")
    );
    expect(dhcpWarn).toBeDefined();
  });

  it("no warnings when all pools are adequately sized", () => {
    const result = engine.allocateClusterIps(makeStretchedCluster(), 4, stretchedCtx());
    const errors = result.warnings.filter((w) => w.severity === "error");
    expect(errors).toHaveLength(0);
  });
});
