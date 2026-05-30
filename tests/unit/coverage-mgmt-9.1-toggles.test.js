// @vitest-environment node
//
// Workbook coverage sweep — two 9.1 mgmt-cluster toggles on Deploy
// Management Domain that the studio modeled but never stamped:
//   L49 "Dual stack networking"            (Selected/Unselected)
//   L59 "Activate vSAN Data-in-Transit encryption" (Selected/Unselected)
// Cells verified against the pristine 9.1 cell-meta fixture. The model
// fields (cluster.networks.dualStackIpv6, cluster.storage.dataServices.
// dit.enabled) already exist — these are pure cell-map additions.
//
// NOTE: the WLD/Cluster dual-stack cell uses "Include"/"Exclude"; the
// Deploy-Mgmt L49 dropdown uses "Selected"/"Unselected" — different
// vocabularies for the same boolean, hence a distinct mgmt entry.
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const { WORKBOOK_CELL_MAP } = VcfEngine;

const dualStackMgmt = WORKBOOK_CELL_MAP.find(
  (e) => e.sheet === "Deploy Management Domain" && e.cell === "L49"
);
const ditMgmt = WORKBOOK_CELL_MAP.find(
  (e) => e.sheet === "Deploy Management Domain" && e.cell === "L59"
);

// Minimal mgmt-cluster ctx for resolve/apply.
function ctxWith(cluster) {
  return { cluster, domain: { type: "mgmt" } };
}

describe("coverage sweep — Deploy Mgmt 9.1 dual-stack (L49)", () => {
  it("is a 9.1-only mgmt-cluster Selected/Unselected entry", () => {
    expect(dualStackMgmt).toBeTruthy();
    expect(dualStackMgmt.workbookVersions).toEqual(["9.1"]);
    expect(dualStackMgmt.scope).toBe("mgmt-cluster");
    expect(dualStackMgmt.dataValidation).toEqual(["Selected", "Unselected"]);
  });

  it("round-trips the dualStackIpv6 boolean", () => {
    const on = { networks: { dualStackIpv6: true } };
    expect(dualStackMgmt.resolve(null, ctxWith(on))).toBe("Selected");
    const off = { networks: { dualStackIpv6: false } };
    expect(dualStackMgmt.resolve(null, ctxWith(off))).toBe("Unselected");

    const c = { networks: { dualStackIpv6: false } };
    dualStackMgmt.apply(null, ctxWith(c), "Selected");
    expect(c.networks.dualStackIpv6).toBe(true);
    dualStackMgmt.apply(null, ctxWith(c), "Unselected");
    expect(c.networks.dualStackIpv6).toBe(false);
  });
});

describe("coverage sweep — Deploy Mgmt 9.1 vSAN DIT (L59)", () => {
  it("is a 9.1-only mgmt-cluster Selected/Unselected entry", () => {
    expect(ditMgmt).toBeTruthy();
    expect(ditMgmt.workbookVersions).toEqual(["9.1"]);
    expect(ditMgmt.scope).toBe("mgmt-cluster");
    expect(ditMgmt.dataValidation).toEqual(["Selected", "Unselected"]);
  });

  it("round-trips the dit.enabled boolean", () => {
    const on = { storage: { dataServices: { dit: { enabled: true } } } };
    expect(ditMgmt.resolve(null, ctxWith(on))).toBe("Selected");
    const off = { storage: { dataServices: { dit: { enabled: false } } } };
    expect(ditMgmt.resolve(null, ctxWith(off))).toBe("Unselected");

    const c = { storage: { dataServices: { dit: { enabled: false } } } };
    ditMgmt.apply(null, ctxWith(c), "Selected");
    expect(c.storage.dataServices.dit.enabled).toBe(true);
    ditMgmt.apply(null, ctxWith(c), "Unselected");
    expect(c.storage.dataServices.dit.enabled).toBe(false);
  });
});
