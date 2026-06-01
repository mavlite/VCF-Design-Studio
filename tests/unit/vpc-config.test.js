// VPC / Transit Gateway config — engine round-trip tests.
// Spec: docs/superpowers/specs/2026-06-01-vpc-tgw-ip-block-pools-design.md
// PR-1 covers sub-area A (workload network-connectivity mode). PR-2 adds the
// structured IP-block pools.
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const { WORKBOOK_CELL_MAP, migrateFleet, newFleet, createClusterVpcConfig, createVpcIpBlockPool } = VcfEngine;

function entryByLabel(label) {
  return WORKBOOK_CELL_MAP.find((m) => m.label === label);
}
// Resolve an entry's cell for a given workbook version (mirrors verify-cell-map).
function cellFor(entry, ver) {
  return (entry.cellByVersion && entry.cellByVersion[ver]) || entry.cell;
}

describe("vpcConfig — factory + model", () => {
  it("exports createClusterVpcConfig with a networkConnectivity default", () => {
    expect(typeof createClusterVpcConfig).toBe("function");
    expect(createClusterVpcConfig().networkConnectivity).toBe("Centralized Connectivity");
  });

  it("newFleet clusters carry a vpcConfig", () => {
    const f = newFleet();
    const clu = f.instances[0].domains[0].clusters[0];
    expect(clu.vpcConfig).toBeDefined();
    expect(clu.vpcConfig.networkConnectivity).toBe("Centralized Connectivity");
  });
});

describe("VPC network-connectivity cell-map entry (sub-area A)", () => {
  const entry = () => entryByLabel("VPC Network Connectivity (WLD)");

  it("is a workload-cluster, dual-version Deploy WLD dropdown at D185/D196", () => {
    const e = entry();
    expect(e, "entry 'VPC Network Connectivity (WLD)' must exist").toBeTruthy();
    expect(e.sheet).toBe("Deploy Workload Domain");
    expect(e.scope).toBe("workload-cluster");
    expect(cellFor(e, "9.0")).toBe("D185");
    expect(cellFor(e, "9.1")).toBe("D196");
    expect(e.dataValidation).toEqual(["Centralized Connectivity", "Distributed Connectivity"]);
  });

  it("resolves from and applies to cluster.vpcConfig.networkConnectivity", () => {
    const e = entry();
    const cluster = { vpcConfig: { networkConnectivity: "Distributed Connectivity" } };
    expect(e.resolve({}, { cluster })).toBe("Distributed Connectivity");

    const target = { vpcConfig: createClusterVpcConfig() };
    e.apply({}, { cluster: target }, "Distributed Connectivity");
    expect(target.vpcConfig.networkConnectivity).toBe("Distributed Connectivity");
  });

  it("resolve is safe when vpcConfig is absent (factory default)", () => {
    const e = entry();
    expect(e.resolve({}, { cluster: {} })).toBe("Centralized Connectivity");
  });
});

describe("vpcConfig — structured IP-block pools (sub-areas B+C)", () => {
  it("createVpcIpBlockPool exposes the 5 sub-fields", () => {
    expect(typeof createVpcIpBlockPool).toBe("function");
    expect(Object.keys(createVpcIpBlockPool()).sort()).toEqual(
      ["excludedIps", "ipBlocks", "poolName", "reservedSubnet", "visibility"]
    );
  });

  it("createClusterVpcConfig carries externalPool + tgwPool", () => {
    const v = createClusterVpcConfig();
    expect(v.externalPool).toEqual(createVpcIpBlockPool());
    expect(v.tgwPool).toEqual(createVpcIpBlockPool());
  });

  // Each tuple: [label, sheet, scope, poolKey, field, cell90, cell91, verifyLabel]
  const POOL_CELLS = [
    // Configure Management Domain — external pool
    ["VPC External IP Block — Pool Name (Mgmt)",       "Configure Management Domain", "mgmt-cluster",     "externalPool", "poolName",       null,  "D194", "Pool Name"],
    ["VPC External IP Block — Visibility (Mgmt)",       "Configure Management Domain", "mgmt-cluster",     "externalPool", "visibility",     null,  "D195", "Visability"],
    ["VPC External IP Block — IP Blocks (Mgmt)",        "Configure Management Domain", "mgmt-cluster",     "externalPool", "ipBlocks",       "D188","D196", "VPC External IP Blocks"],
    ["VPC External IP Block — Excluded IPs (Mgmt)",     "Configure Management Domain", "mgmt-cluster",     "externalPool", "excludedIps",    null,  "D197", "Excluded Ips"],
    ["VPC External IP Block — Reserved Subnet (Mgmt)",  "Configure Management Domain", "mgmt-cluster",     "externalPool", "reservedSubnet", null,  "D198", "Reserved for Specific Subnet"],
    // Configure Management Domain — TGW pool
    ["Private TGW IP Block — Pool Name (Mgmt)",         "Configure Management Domain", "mgmt-cluster",     "tgwPool",      "poolName",       null,  "D199", "Pool Name"],
    ["Private TGW IP Block — IP Blocks (Mgmt)",         "Configure Management Domain", "mgmt-cluster",     "tgwPool",      "ipBlocks",       "D189","D201", "Private - Transit Gateway IP Blocks"],
    ["Private TGW IP Block — Reserved Subnet (Mgmt)",   "Configure Management Domain", "mgmt-cluster",     "tgwPool",      "reservedSubnet", null,  "D203", "Reserved for Specific Subnet"],
    // Configure Workload Domain — external pool
    ["VPC External IP Block — Pool Name (WLD)",         "Configure Workload Domain",   "workload-cluster", "externalPool", "poolName",       null,  "D137", "Pool Name"],
    ["VPC External IP Block — IP Blocks (WLD)",         "Configure Workload Domain",   "workload-cluster", "externalPool", "ipBlocks",       "D131","D139", "VPC External IP Blocks"],
    // Configure Workload Domain — TGW pool
    ["Private TGW IP Block — IP Blocks (WLD)",          "Configure Workload Domain",   "workload-cluster", "tgwPool",      "ipBlocks",       "D132","D144", "Private - Transit Gateway IP Blocks"],
    ["Private TGW IP Block — Reserved Subnet (WLD)",    "Configure Workload Domain",   "workload-cluster", "tgwPool",      "reservedSubnet", null,  "D146", "Reserved for Specific Subnet"],
  ];

  it.each(POOL_CELLS)("%s maps correctly", (label, sheet, scope, poolKey, field, cell90, cell91, verifyLabel) => {
    const e = entryByLabel(label);
    expect(e, `entry '${label}' must exist`).toBeTruthy();
    expect(e.sheet).toBe(sheet);
    expect(e.scope).toBe(scope);
    expect(e.verifyLabel).toBe(verifyLabel);
    expect(cellFor(e, "9.1")).toBe(cell91);
    if (cell90 === null) {
      // 9.1-only field
      expect(e.workbookVersions).toEqual(["9.1"]);
    } else {
      expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
      expect(cellFor(e, "9.0")).toBe(cell90);
    }
    // resolve/apply round-trip through the nested pool field
    const cluster = { vpcConfig: { [poolKey]: { ...createVpcIpBlockPool(), [field]: "sentinel-val" } } };
    expect(e.resolve({}, { cluster })).toBe("sentinel-val");
    const target = { vpcConfig: createClusterVpcConfig() };
    e.apply({}, { cluster: target }, "applied-val");
    expect(target.vpcConfig[poolKey][field]).toBe("applied-val");
  });
});

describe("vpcConfig — migrateFleet", () => {
  it("backfills vpcConfig on a legacy fleet lacking it", () => {
    const f = migrateFleet({ version: "vcf-sizer-v9", instances: [
      { id: "i1", domains: [{ type: "mgmt", clusters: [{ id: "c1" }] }] },
    ] });
    const clu = f.instances[0].domains[0].clusters[0];
    expect(clu.vpcConfig).toBeDefined();
    expect(clu.vpcConfig.networkConnectivity).toBe("Centralized Connectivity");
  });

  it("preserves a hand-set networkConnectivity through migration", () => {
    const f = migrateFleet({ version: "vcf-sizer-v9", instances: [
      { id: "i1", domains: [{ type: "workload", clusters: [
        { id: "c1", vpcConfig: { networkConnectivity: "Distributed Connectivity" } },
      ] }] },
    ] });
    const clu = f.instances[0].domains[0].clusters[0];
    expect(clu.vpcConfig.networkConnectivity).toBe("Distributed Connectivity");
  });

  it("backfills the pool sub-objects and preserves hand-set nested values", () => {
    const f = migrateFleet({ version: "vcf-sizer-v9", instances: [
      { id: "i1", domains: [{ type: "mgmt", clusters: [
        { id: "c1", vpcConfig: { externalPool: { ipBlocks: "10.0.0.0/16", poolName: "ext-1" } } },
      ] }] },
    ] });
    const vpc = f.instances[0].domains[0].clusters[0].vpcConfig;
    expect(vpc.externalPool.ipBlocks).toBe("10.0.0.0/16");
    expect(vpc.externalPool.poolName).toBe("ext-1");
    expect(vpc.externalPool.visibility).toBe("");      // backfilled
    expect(vpc.tgwPool).toEqual(createVpcIpBlockPool()); // backfilled whole
  });
});
