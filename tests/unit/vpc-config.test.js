// VPC / Transit Gateway config — engine round-trip tests.
// Spec: docs/superpowers/specs/2026-06-01-vpc-tgw-ip-block-pools-design.md
// PR-1 covers sub-area A (workload network-connectivity mode). PR-2 adds the
// structured IP-block pools.
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const { WORKBOOK_CELL_MAP, migrateFleet, newFleet, createClusterVpcConfig } = VcfEngine;

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
});
