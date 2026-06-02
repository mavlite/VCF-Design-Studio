// Per-network IP Assignment (Static | DHCP | SLAAC) — the per-network-pool
// blocks on Deploy WLD/Cluster (vmotion/vsan/hostTep/edgeTep). All 9.1-only.
// Maps to cluster.networks.<protocol>.ipAssignment. (mgmt cluster has no cell.)
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const { WORKBOOK_CELL_MAP, createClusterNetworks, migrateFleet } = VcfEngine;

function entryByLabel(label) { return WORKBOOK_CELL_MAP.find((m) => m.label === label); }

describe("networks.<protocol>.ipAssignment — factory + migrate", () => {
  it("vmotion/vsan/hostTep/edgeTep default ipAssignment to Static", () => {
    const n = createClusterNetworks();
    for (const k of ["vmotion", "vsan", "hostTep", "edgeTep"]) {
      expect(n[k].ipAssignment, k).toBe("Static");
    }
  });

  it("migrateFleet backfills ipAssignment and preserves a hand-set value", () => {
    const f = migrateFleet({ version: "vcf-sizer-v9", instances: [
      { id: "i1", domains: [{ type: "workload", clusters: [
        { id: "c1", networks: { vmotion: { ipAssignment: "SLAAC" }, vsan: {} } },
      ] }] },
    ] });
    const nets = f.instances[0].domains[0].clusters[0].networks;
    expect(nets.vmotion.ipAssignment).toBe("SLAAC");  // preserved
    expect(nets.vsan.ipAssignment).toBe("Static");     // backfilled
  });
});

describe("IP Assignment cell-map entries (per-network pool)", () => {
  // [label, sheet, scope, cell91, networkKey]
  const ROWS = [
    ["WLD vMotion IP Assignment",                   "Deploy Workload Domain", "workload-cluster",   "D87",  "vmotion"],
    ["WLD vSAN IP Assignment",                      "Deploy Workload Domain", "workload-cluster",   "D98",  "vsan"],
    ["WLD Host TEP IP Assignment",                  "Deploy Workload Domain", "workload-cluster",   "D109", "hostTep"],
    ["WLD Edge TEP IP Assignment",                  "Deploy Workload Domain", "workload-cluster",   "D120", "edgeTep"],
    ["Additional Cluster vMotion IP Assignment",    "Deploy Cluster",         "additional-cluster", "D53",  "vmotion"],
    ["Additional Cluster vSAN IP Assignment",       "Deploy Cluster",         "additional-cluster", "D64",  "vsan"],
    ["Additional Cluster Host TEP IP Assignment",   "Deploy Cluster",         "additional-cluster", "D75",  "hostTep"],
    ["Additional Cluster Edge TEP IP Assignment",   "Deploy Cluster",         "additional-cluster", "D86",  "edgeTep"],
  ];

  it.each(ROWS)("%s maps to networks.%s.ipAssignment", (label, sheet, scope, cell91, key) => {
    const e = entryByLabel(label);
    expect(e, `entry '${label}' must exist`).toBeTruthy();
    expect(e.sheet).toBe(sheet);
    expect(e.scope).toBe(scope);
    expect(e.verifyLabel).toBe("IP Assignment");
    expect(e.workbookVersions).toEqual(["9.1"]);
    expect((e.cellByVersion && e.cellByVersion["9.1"]) || e.cell).toBe(cell91);
    expect(e.dataValidation).toEqual(["Static", "DHCP", "SLAAC"]);
    const cluster = { networks: { [key]: { ...createClusterNetworks()[key], ipAssignment: "DHCP" } } };
    expect(e.resolve({}, { cluster })).toBe("DHCP");
    const target = { networks: createClusterNetworks() };
    e.apply({}, { cluster: target }, "SLAAC");
    expect(target.networks[key].ipAssignment).toBe("SLAAC");
  });

  it("apply coerces an out-of-enum value to Static", () => {
    const e = entryByLabel("WLD vMotion IP Assignment");
    const target = { networks: createClusterNetworks() };
    e.apply({}, { cluster: target }, "garbage");
    expect(target.networks.vmotion.ipAssignment).toBe("Static");
  });
});
