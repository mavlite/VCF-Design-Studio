import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { effectiveStack, VCF_OPS_APPLIANCE_IDS, newFleet, sizeFleet } = VcfEngine;

describe("effectiveStack", () => {
  const stack = [
    { id: "vcenter", size: "Medium", instances: 1, key: "k1" },
    { id: "vcfOps", size: "Medium", instances: 3, key: "k2" },
    { id: "vcfAuto", size: "Small", instances: 1, key: "k3" },
    { id: "fleetMgr", size: "Small", instances: 1, key: "k4" },
  ];
  it("is identity (same reference) when Ops on (true/undefined)", () => {
    expect(effectiveStack(stack, true)).toBe(stack);
    expect(effectiveStack(stack, undefined)).toBe(stack);
  });
  it("removes the 6 Ops/Automation ids when off; keeps core (fleetMgr) + others", () => {
    const out = effectiveStack(stack, false);
    expect(out.map((e) => e.id)).toEqual(["vcenter", "fleetMgr"]);
  });
  it("the id set is exactly the 6 Ops/Automation appliances", () => {
    expect([...VCF_OPS_APPLIANCE_IDS].sort()).toEqual(
      ["vcfAuto", "vcfOps", "vcfOpsCollector", "vcfOpsLogs", "vcfOpsNet", "vcfOpsNetCollector"].sort()
    );
  });
  it("tolerates null/empty", () => {
    expect(effectiveStack(null, false)).toEqual([]);
    expect(effectiveStack([], false)).toEqual([]);
  });
});
