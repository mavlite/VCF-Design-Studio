// @vitest-environment node
//
// WI-1 (week of 2026-06-01) — fleet-level "Transit Gateway type" (9.1).
// Deploy Management Domain L53, dropdown
//   ["Distributed connectivity","Centralized connectivity"],
// default "Centralized connectivity", 9.1-ONLY (absent on 9.0). Verified
// against the pristine 9.1 cell-meta fixture. Fleet-level choice in the
// mgmt-domain post-deployment-options section (sibling of L47 vDPG flag).
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const { newFleet, migrateFleet, WORKBOOK_CELL_MAP } = VcfEngine;

const entry = WORKBOOK_CELL_MAP.find(
  (e) => e.sheet === "Deploy Management Domain" && e.cell === "L53"
);

describe("WI-1 — Transit Gateway type (9.1)", () => {
  it("newFleet defaults transitGatewayType to 'Centralized connectivity'", () => {
    expect(newFleet().transitGatewayType).toBe("Centralized connectivity");
  });

  it("has a 9.1-only cell-map entry at Deploy Management Domain L53", () => {
    expect(entry).toBeTruthy();
    expect(entry.workbookVersions).toEqual(["9.1"]);
    expect(entry.dataValidation).toEqual([
      "Distributed connectivity",
      "Centralized connectivity",
    ]);
  });

  it("resolve returns the fleet value (falling back to the default)", () => {
    expect(entry.resolve({ transitGatewayType: "Distributed connectivity" }, {})).toBe("Distributed connectivity");
    expect(entry.resolve({}, {})).toBe("Centralized connectivity");
  });

  it("apply sets the fleet value", () => {
    const f = {};
    entry.apply(f, {}, "Distributed connectivity");
    expect(f.transitGatewayType).toBe("Distributed connectivity");
  });

  it("migrateFleet preserves an explicit value on a current (v9) fleet", () => {
    const f = newFleet();
    f.version = "vcf-sizer-v9";
    f.transitGatewayType = "Distributed connectivity";
    const migrated = migrateFleet(JSON.parse(JSON.stringify(f)));
    expect(migrated.transitGatewayType).toBe("Distributed connectivity");
  });
});
