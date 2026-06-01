// @vitest-environment node
//
// WI-3 (week of 2026-06-01) — per-vDS-slot Type / Number of Uplinks /
// Physical Network Adapters Used. Model expansion: each cluster.networks
// .vds[i] gains linkType ("VDS Uplinks"|"VDS LAG"), numUplinks, physAdapters.
// Cells exist on BOTH 9.0 and 9.1 across Deploy Mgmt (Type+Uplinks only) /
// Deploy WLD / Deploy Cluster (Type+Uplinks+Adapters). Verified against the
// pristine fixtures. Stamped via the existing _vdsBlockEntries per-slot builder.
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const { newFleet, WORKBOOK_CELL_MAP } = VcfEngine;

const byLabel = (sheet, label) => WORKBOOK_CELL_MAP.find((e) => e.sheet === sheet && e.label === label);
const ctxVds = (vds) => ({ cluster: { networks: { vds: [vds] } } });

describe("WI-3 — vDS slot model defaults", () => {
  it("newFleet vds entries carry linkType/numUplinks/physAdapters", () => {
    const vds = newFleet().instances[0].domains[0].clusters[0].networks.vds[0];
    expect(vds.linkType).toBe("VDS Uplinks");
    expect(typeof vds.numUplinks).toBe("number");
    expect(typeof vds.physAdapters).toBe("number");
  });
});

describe("WI-3 — Type (link type) cell-map entry", () => {
  const e = byLabel("Deploy Management Domain", "vDS 1 Link Type");
  it("exists for Deploy Mgmt vDS 1 on both versions, Selected dropdown", () => {
    expect(e).toBeTruthy();
    expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
    expect(e.dataValidation).toEqual(["VDS Uplinks", "VDS LAG"]);
  });
  it("round-trips linkType", () => {
    expect(e.resolve(null, ctxVds({ linkType: "VDS LAG", lag: {} }))).toBe("VDS LAG");
    expect(e.resolve(null, ctxVds({ lag: {} }))).toBe("VDS Uplinks"); // default
    const c = ctxVds({ lag: {} });
    e.apply(null, c, "VDS LAG");
    expect(c.cluster.networks.vds[0].linkType).toBe("VDS LAG");
  });
});

describe("WI-3 — Number of Uplinks cell-map entry", () => {
  const e = byLabel("Deploy Management Domain", "vDS 1 Number of Uplinks");
  it("round-trips numUplinks as an integer", () => {
    expect(e).toBeTruthy();
    expect(e.resolve(null, ctxVds({ numUplinks: 4, lag: {} }))).toBe("4");
    const c = ctxVds({ lag: {} });
    e.apply(null, c, "4");
    expect(c.cluster.networks.vds[0].numUplinks).toBe(4);
  });
});

describe("WI-3 — Physical Network Adapters Used", () => {
  it("exists on Deploy WLD but NOT on Deploy Mgmt (no mgmt cell)", () => {
    expect(byLabel("Deploy Workload Domain", "vDS 1 Physical Network Adapters Used")).toBeTruthy();
    expect(byLabel("Deploy Management Domain", "vDS 1 Physical Network Adapters Used")).toBeFalsy();
  });
  it("round-trips physAdapters on Deploy WLD", () => {
    const e = byLabel("Deploy Workload Domain", "vDS 1 Physical Network Adapters Used");
    expect(e.resolve(null, ctxVds({ physAdapters: 8, lag: {} }))).toBe("8");
    const c = ctxVds({ lag: {} });
    e.apply(null, c, "8");
    expect(c.cluster.networks.vds[0].physAdapters).toBe(8);
  });
});
