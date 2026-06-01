import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

// Theme N — 9.0 backfill of themes 11/12/13 (~55 entry/version combos).
//
// Themes 11/12/13 originally shipped 9.1-only because they introduce
// concepts new in 9.1 (Supervisor/VKS, GM cluster identity, AZ2 host
// overlay). The 9.0 workbook ALSO carries equivalent cells at shifted
// addresses. PR #72 backfilled those, flipping the affected entries to
// dual-version cellByVersion + workbookVersions=["9.0","9.1"].
//
// Per-theme tests (theme-11/12/13.test.js) cover the 9.1 round-trip
// thoroughly. Themes 12 and 13 already ship 9.0 round-trip too. Theme
// 11's 9.0 coverage is emit-only — this file adds the missing 9.0
// round-trip for Supervisor + a cross-theme entry-shape sweep that
// catches any silent reversion of Theme N's dual-version flips.

const {
  newFleet,
  newWorkloadDomain,
  WORKBOOK_CELL_MAP,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
} = VcfEngine;

function fleetWith90Wld() {
  const f = newFleet();
  f.vcfVersion = "9.0";
  f.version = "vcf-sizer-v9";
  f.instances[0].domains.push(newWorkloadDomain("WLD-01"));
  return f;
}

function mgmtCluster(f) { return f.instances[0].domains[0].clusters[0]; }
function wldCluster(f) { return f.instances[0].domains.find((d) => d.type === "workload").clusters[0]; }

describe("Theme N — 9.0 backfill: cross-theme entry-shape sweep", () => {
  // The 9 Supervisor cells per cluster scope Theme N flipped to dual-
  // version. (Admin Password is dual but vault-only, so it doesn't emit
  // via CSV — covered by the entry-shape sweep but not by round-trip.)
  const SUPERVISOR_DUAL_LABELS_PER_SCOPE = [
    "Supervisor Version",
    "Supervisor Edge Cluster Size",
    "Supervisor Admin Password",  // vault, doesn't CSV round-trip
    "Supervisor Node 1 IP",
    "Supervisor Node 2 IP",
    "Supervisor Node 3 IP",
    "Supervisor Cluster VIP",
    "Supervisor Cluster FQDN",
    "Supervisor Cluster Name",
  ];

  it("every Supervisor stamp-cell entry is dual-version on both Mgmt + WLD scopes", () => {
    for (const baseLabel of SUPERVISOR_DUAL_LABELS_PER_SCOPE) {
      for (const suffix of ["(Mgmt)", "(WLD)"]) {
        const label = `${baseLabel} ${suffix}`;
        const e = WORKBOOK_CELL_MAP.find((x) => x.label === label);
        expect(e, `expected entry ${label}`).toBeTruthy();
        expect(e.workbookVersions, `${label} workbookVersions`).toEqual(["9.0", "9.1"]);
        expect(e.cellByVersion, `${label} cellByVersion`).toBeTruthy();
        expect(e.cellByVersion["9.1"]).toMatch(/^[DL]\d+$/);
        // 9.0 is the top-level cell field per the dual-version convention.
        expect(e.cell).toMatch(/^[DL]\d+$/);
      }
    }
  });
});

describe("Theme N — 9.0 round-trip for Supervisor (Theme 11)", () => {
  it("9.0 CSV round-trip reconstructs the 8 dual-version Supervisor stamp fields on mgmt + workload clusters", () => {
    const original = fleetWith90Wld();
    const mgmt = mgmtCluster(original);
    mgmt.supervisorConfig.enabled = true;
    mgmt.supervisorConfig.version = "v1.28";
    mgmt.supervisorConfig.edgeClusterSize = "Large";
    mgmt.supervisorConfig.node1Ip = "10.0.0.10";
    mgmt.supervisorConfig.node2Ip = "10.0.0.11";
    mgmt.supervisorConfig.node3Ip = "10.0.0.12";
    mgmt.supervisorConfig.clusterVip = "10.0.0.20";
    mgmt.supervisorConfig.clusterFqdn = "sup-mgmt.lab.local";
    mgmt.supervisorConfig.clusterName = "sup-mgmt-cluster";

    const wld = wldCluster(original);
    wld.supervisorConfig.enabled = true;
    wld.supervisorConfig.version = "v1.29";
    wld.supervisorConfig.edgeClusterSize = "Small";
    wld.supervisorConfig.node1Ip = "10.1.0.10";
    wld.supervisorConfig.node2Ip = "10.1.0.11";
    wld.supervisorConfig.node3Ip = "10.1.0.12";
    wld.supervisorConfig.clusterVip = "10.1.0.20";
    wld.supervisorConfig.clusterFqdn = "sup-wld.lab.local";
    wld.supervisorConfig.clusterName = "sup-wld-cluster";

    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.0" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.0" });

    const reMgmt = mgmtCluster(rebuilt);
    expect(reMgmt.supervisorConfig.version).toBe("v1.28");
    expect(reMgmt.supervisorConfig.edgeClusterSize).toBe("Large");
    expect(reMgmt.supervisorConfig.node1Ip).toBe("10.0.0.10");
    expect(reMgmt.supervisorConfig.node2Ip).toBe("10.0.0.11");
    expect(reMgmt.supervisorConfig.node3Ip).toBe("10.0.0.12");
    expect(reMgmt.supervisorConfig.clusterVip).toBe("10.0.0.20");
    expect(reMgmt.supervisorConfig.clusterFqdn).toBe("sup-mgmt.lab.local");
    expect(reMgmt.supervisorConfig.clusterName).toBe("sup-mgmt-cluster");

    const reWld = wldCluster(rebuilt);
    expect(reWld.supervisorConfig.version).toBe("v1.29");
    expect(reWld.supervisorConfig.edgeClusterSize).toBe("Small");
    expect(reWld.supervisorConfig.node1Ip).toBe("10.1.0.10");
    expect(reWld.supervisorConfig.node2Ip).toBe("10.1.0.11");
    expect(reWld.supervisorConfig.node3Ip).toBe("10.1.0.12");
    expect(reWld.supervisorConfig.clusterVip).toBe("10.1.0.20");
    expect(reWld.supervisorConfig.clusterFqdn).toBe("sup-wld.lab.local");
    expect(reWld.supervisorConfig.clusterName).toBe("sup-wld-cluster");
  });

  it("9.0 emit excludes 9.1-only Supervisor fields (Networking Stack, Service CIDR, deployment extras)", () => {
    const f = fleetWith90Wld();
    const wld = wldCluster(f);
    wld.supervisorConfig.networkingStack = "vSphere Distributed Switch";
    wld.supervisorConfig.serviceCidr = "172.31.0.0/16";
    wld.supervisorConfig.deployment.vds = "vds-wld";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    // None of these labels should appear in a 9.0 emit.
    expect(rows.find((r) => r.label === "Supervisor Networking Stack (WLD)")).toBeUndefined();
    expect(rows.find((r) => r.label === "Supervisor Service CIDR (WLD)")).toBeUndefined();
    expect(rows.find((r) => /^Supervisor Deployment /.test(r.label || ""))).toBeUndefined();
  });
});
