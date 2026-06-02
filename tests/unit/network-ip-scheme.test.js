// Per-network IP Scheme (IPv4 | IPv6) — Deploy Mgmt L50/L51 (vMotion/Storage)
// + per-network-pool blocks on Deploy WLD/Cluster (vmotion/vsan/hostTep/edgeTep).
// All 9.1-only. Maps to cluster.networks.<protocol>.ipScheme.
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const { WORKBOOK_CELL_MAP, createClusterNetworks, migrateFleet } = VcfEngine;

function entryByLabel(label) { return WORKBOOK_CELL_MAP.find((m) => m.label === label); }

describe("networks.<protocol>.ipScheme — factory + migrate", () => {
  it("vmotion/vsan/hostTep/edgeTep default ipScheme to IPv4", () => {
    const n = createClusterNetworks();
    for (const k of ["vmotion", "vsan", "hostTep", "edgeTep"]) {
      expect(n[k].ipScheme, k).toBe("IPv4");
    }
  });

  it("migrateFleet backfills ipScheme and preserves a hand-set value", () => {
    const f = migrateFleet({ version: "vcf-sizer-v9", instances: [
      { id: "i1", domains: [{ type: "mgmt", clusters: [
        { id: "c1", networks: { vmotion: { ipScheme: "IPv6" }, vsan: {} } },
      ] }] },
    ] });
    const nets = f.instances[0].domains[0].clusters[0].networks;
    expect(nets.vmotion.ipScheme).toBe("IPv6");  // preserved
    expect(nets.vsan.ipScheme).toBe("IPv4");      // backfilled
  });
});

describe("IP Scheme cell-map entries", () => {
  // [label, sheet, scope, cell91, networkKey]
  const ROWS = [
    ["vMotion IP Scheme",                          "Deploy Management Domain", "mgmt-cluster",       "L50",  "vmotion"],
    ["vSAN IP Scheme",                             "Deploy Management Domain", "mgmt-cluster",       "L51",  "vsan"],
    ["WLD vMotion IP Scheme",                      "Deploy Workload Domain",   "workload-cluster",   "D84",  "vmotion"],
    ["WLD vSAN IP Scheme",                         "Deploy Workload Domain",   "workload-cluster",   "D95",  "vsan"],
    ["WLD Host TEP IP Scheme",                     "Deploy Workload Domain",   "workload-cluster",   "D106", "hostTep"],
    ["WLD Edge TEP IP Scheme",                     "Deploy Workload Domain",   "workload-cluster",   "D117", "edgeTep"],
    ["Additional Cluster vMotion IP Scheme",       "Deploy Cluster",           "additional-cluster", "D50",  "vmotion"],
    ["Additional Cluster vSAN IP Scheme",          "Deploy Cluster",           "additional-cluster", "D61",  "vsan"],
    ["Additional Cluster Host TEP IP Scheme",      "Deploy Cluster",           "additional-cluster", "D72",  "hostTep"],
    ["Additional Cluster Edge TEP IP Scheme",      "Deploy Cluster",           "additional-cluster", "D83",  "edgeTep"],
  ];

  it.each(ROWS)("%s maps to networks.%s.ipScheme", (label, sheet, scope, cell91, key) => {
    const e = entryByLabel(label);
    expect(e, `entry '${label}' must exist`).toBeTruthy();
    expect(e.sheet).toBe(sheet);
    expect(e.scope).toBe(scope);
    expect(e.verifyLabel).toBe("IP Scheme");
    expect(e.workbookVersions).toEqual(["9.1"]);
    expect((e.cellByVersion && e.cellByVersion["9.1"]) || e.cell).toBe(cell91);
    expect(e.dataValidation).toEqual(["IPv4", "IPv6"]);
    const cluster = { networks: { [key]: { ...createClusterNetworks()[key], ipScheme: "IPv6" } } };
    expect(e.resolve({}, { cluster })).toBe("IPv6");
    const target = { networks: createClusterNetworks() };
    e.apply({}, { cluster: target }, "IPv6");
    expect(target.networks[key].ipScheme).toBe("IPv6");
  });

  it("apply coerces an out-of-enum value to IPv4", () => {
    const e = entryByLabel("WLD vMotion IP Scheme");
    const target = { networks: createClusterNetworks() };
    e.apply({}, { cluster: target }, "garbage");
    expect(target.networks.vmotion.ipScheme).toBe("IPv4");
  });
});
