import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { newFleet, sizeFleet, emitWorkbookCellMap, CAPABILITY_REGISTRY } = VcfEngine;

// Emit cell rows for a fleet. emitWorkbookCellMap(fleet, fleetResult) returns
// [{ workbookVersion, sheet, cell, label, value }].
function rows(fleet) {
  return emitWorkbookCellMap(fleet, sizeFleet(fleet));
}

describe("export-gating mechanism", () => {
  it("emitWorkbookCellMap + CAPABILITY_REGISTRY are exported", () => {
    expect(typeof emitWorkbookCellMap).toBe("function");
    expect(Array.isArray(CAPABILITY_REGISTRY)).toBe(true);
  });

  it("untagged entries are unaffected (a known always-on cell still stamps)", () => {
    const fleet = newFleet();
    fleet.networkConfig = fleet.networkConfig || {};
    fleet.networkConfig.dns = { primaryDomain: "lab.example.com" };
    const r = rows(fleet);
    expect(r.some((x) => x.value === "lab.example.com")).toBe(true);
  });
});
