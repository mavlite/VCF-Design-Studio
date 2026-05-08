import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const { APPLIANCE_DB, PLACEMENT_CONSTRAINTS, placementOptionsFor } = VcfEngine;

// ─────────────────────────────────────────────────────────────────────────────
// Plan 2 — placementConstraint metadata + placementOptionsFor() helper
//
// Each appliance carries a placementConstraint:
//   - "mgmt-only-greenfield" — wld vCenter, wld NSX Manager, Avi Controller.
//     Forced onto mgmt clusters unless the owning domain is imported.
//   - "flexible" — NSX Edge. Either mgmt or wld cluster, user choice.
//   - "wld-only" — VKS Supervisor (cluster-internal data plane).
// ─────────────────────────────────────────────────────────────────────────────

describe("VCF-INV-003 / Plan 2 — APPLIANCE_DB placement constraints", () => {
  it("vcenter is mgmt-only-greenfield", () => {
    expect(APPLIANCE_DB.vcenter.placementConstraint).toBe("mgmt-only-greenfield");
  });

  it("nsxMgr is mgmt-only-greenfield", () => {
    expect(APPLIANCE_DB.nsxMgr.placementConstraint).toBe("mgmt-only-greenfield");
  });

  it("aviLb is mgmt-only-greenfield (Controller portion; SE split is Plan 3)", () => {
    expect(APPLIANCE_DB.aviLb.placementConstraint).toBe("mgmt-only-greenfield");
  });

  it("nsxEdge is flexible (VCF-APP-006-SUP-1/4 — mgmt or wld)", () => {
    expect(APPLIANCE_DB.nsxEdge.placementConstraint).toBe("flexible");
  });

  it("vksSupervisor is wld-only (cluster-internal)", () => {
    expect(APPLIANCE_DB.vksSupervisor.placementConstraint).toBe("wld-only");
  });

  it("PLACEMENT_CONSTRAINTS exposes the canonical string values", () => {
    expect(PLACEMENT_CONSTRAINTS.MGMT_ONLY_GREENFIELD).toBe("mgmt-only-greenfield");
    expect(PLACEMENT_CONSTRAINTS.FLEXIBLE).toBe("flexible");
    expect(PLACEMENT_CONSTRAINTS.WLD_ONLY).toBe("wld-only");
  });
});

const MGMT = [{ id: "clu-mgmt-1", label: "Mgmt / m1" }, { id: "clu-mgmt-2", label: "Mgmt / m2" }];
const WLD = [{ id: "clu-wld-1", label: "WLD / w1" }, { id: "clu-wld-2", label: "WLD / w2" }];

describe("placementOptionsFor — mgmt-only-greenfield (vCenter / NSX Mgr / Avi)", () => {
  it("greenfield WLD: returns mgmt clusters only, in mgmt order", () => {
    const opts = placementOptionsFor("vcenter", {
      isImportedDomain: false,
      mgmtClusters: MGMT,
      wldClusters: WLD,
    });
    expect(opts).toHaveLength(2);
    expect(opts.map((o) => o.id)).toEqual(["clu-mgmt-1", "clu-mgmt-2"]);
    expect(opts.every((o) => o.scope === "mgmt")).toBe(true);
  });

  it("imported WLD: returns mgmt + wld clusters (brownfield exception)", () => {
    const opts = placementOptionsFor("vcenter", {
      isImportedDomain: true,
      mgmtClusters: MGMT,
      wldClusters: WLD,
    });
    expect(opts).toHaveLength(4);
    expect(opts.map((o) => o.scope)).toEqual(["mgmt", "mgmt", "wld", "wld"]);
  });

  it("nsxMgr behaves identically to vCenter under the same constraint", () => {
    const greenfield = placementOptionsFor("nsxMgr", {
      isImportedDomain: false,
      mgmtClusters: MGMT,
      wldClusters: WLD,
    });
    expect(greenfield.map((o) => o.scope)).toEqual(["mgmt", "mgmt"]);
  });

  it("aviLb behaves identically to vCenter under the same constraint", () => {
    const greenfield = placementOptionsFor("aviLb", {
      isImportedDomain: false,
      mgmtClusters: MGMT,
      wldClusters: WLD,
    });
    expect(greenfield.map((o) => o.scope)).toEqual(["mgmt", "mgmt"]);
  });
});

describe("placementOptionsFor — flexible (NSX Edge)", () => {
  it("greenfield WLD: returns mgmt + wld (user design choice)", () => {
    const opts = placementOptionsFor("nsxEdge", {
      isImportedDomain: false,
      mgmtClusters: MGMT,
      wldClusters: WLD,
    });
    expect(opts).toHaveLength(4);
    expect(opts.map((o) => o.scope)).toEqual(["mgmt", "mgmt", "wld", "wld"]);
  });

  it("imported WLD: also returns both groups", () => {
    const opts = placementOptionsFor("nsxEdge", {
      isImportedDomain: true,
      mgmtClusters: MGMT,
      wldClusters: WLD,
    });
    expect(opts).toHaveLength(4);
  });
});

describe("placementOptionsFor — wld-only (VKS Supervisor)", () => {
  it("returns wld clusters only, regardless of imported", () => {
    const opts = placementOptionsFor("vksSupervisor", {
      isImportedDomain: false,
      mgmtClusters: MGMT,
      wldClusters: WLD,
    });
    expect(opts.map((o) => o.scope)).toEqual(["wld", "wld"]);
  });
});

describe("placementOptionsFor — fallback / edge cases", () => {
  it("unknown appliance id: returns mgmt + wld together (legacy permissive)", () => {
    const opts = placementOptionsFor("notARealApplianceId", {
      isImportedDomain: false,
      mgmtClusters: MGMT,
      wldClusters: WLD,
    });
    expect(opts).toHaveLength(4);
  });

  it("appliance with no placementConstraint defaults to flexible behavior", () => {
    // sddcMgr has no placementConstraint set (it's per-instance, not per-domain)
    const opts = placementOptionsFor("sddcMgr", {
      isImportedDomain: false,
      mgmtClusters: MGMT,
      wldClusters: WLD,
    });
    expect(opts.length).toBeGreaterThan(0);
  });

  it("empty cluster arrays produce empty results without crashing", () => {
    const opts = placementOptionsFor("vcenter", {
      isImportedDomain: false,
      mgmtClusters: [],
      wldClusters: [],
    });
    expect(opts).toEqual([]);
  });

  it("missing context object does not crash", () => {
    const opts = placementOptionsFor("vcenter", {});
    expect(Array.isArray(opts)).toBe(true);
  });

  it("scope tag is added to each returned option", () => {
    const opts = placementOptionsFor("nsxEdge", {
      mgmtClusters: [{ id: "m1", label: "A" }],
      wldClusters: [{ id: "w1", label: "B" }],
    });
    expect(opts[0].scope).toBe("mgmt");
    expect(opts[1].scope).toBe("wld");
  });
});
