// @vitest-environment node
//
// WI-2 (week of 2026-06-01) — fleet-level VM/VCF management-network choice
// (9.1). Deploy Management Domain:
//   L45 "VM management network"  -> fleet.vmManagementNetwork
//        ["Use a separate dedicated network","Use ESX management network"]
//   L46 "VCF management network" -> fleet.vcfManagementNetwork
//        ["Use a separate dedicated network","Use VM management network"]
// Both 9.1-ONLY (absent on 9.0), verified against the pristine fixture.
// Independent fleet-level dropdowns: the workbook's L117/L118 VCFMS pool
// SAMPLE formula references L46, but the studio stamps those pool cells
// directly from the model, so these are plain pass-through choices.
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const { newFleet, migrateFleet, WORKBOOK_CELL_MAP } = VcfEngine;

// Find by LABEL, not cell: base cell L45 is shared with the "DNS Server #2"
// entry (9.0 L45; remapped to L73 on 9.1), so a cell-only find would match it.
const vmEntry = WORKBOOK_CELL_MAP.find((e) => e.sheet === "Deploy Management Domain" && e.label === "VM management network");
const vcfEntry = WORKBOOK_CELL_MAP.find((e) => e.sheet === "Deploy Management Domain" && e.label === "VCF management network");

describe("WI-2 — VM management network (L45, 9.1)", () => {
  it("newFleet default + 9.1-only entry shape", () => {
    expect(newFleet().vmManagementNetwork).toBe("Use a separate dedicated network");
    expect(vmEntry).toBeTruthy();
    expect(vmEntry.workbookVersions).toEqual(["9.1"]);
    expect(vmEntry.dataValidation).toEqual(["Use a separate dedicated network", "Use ESX management network"]);
  });
  it("resolve/apply round-trip", () => {
    expect(vmEntry.resolve({ vmManagementNetwork: "Use ESX management network" }, {})).toBe("Use ESX management network");
    expect(vmEntry.resolve({}, {})).toBe("Use a separate dedicated network");
    const f = {};
    vmEntry.apply(f, {}, "Use ESX management network");
    expect(f.vmManagementNetwork).toBe("Use ESX management network");
  });
});

describe("WI-2 — VCF management network (L46, 9.1)", () => {
  it("newFleet default + 9.1-only entry shape", () => {
    expect(newFleet().vcfManagementNetwork).toBe("Use VM management network");
    expect(vcfEntry).toBeTruthy();
    expect(vcfEntry.workbookVersions).toEqual(["9.1"]);
    expect(vcfEntry.dataValidation).toEqual(["Use a separate dedicated network", "Use VM management network"]);
  });
  it("resolve/apply round-trip", () => {
    expect(vcfEntry.resolve({ vcfManagementNetwork: "Use a separate dedicated network" }, {})).toBe("Use a separate dedicated network");
    expect(vcfEntry.resolve({}, {})).toBe("Use VM management network");
    const f = {};
    vcfEntry.apply(f, {}, "Use a separate dedicated network");
    expect(f.vcfManagementNetwork).toBe("Use a separate dedicated network");
  });
});

describe("WI-2 — migrate preservation", () => {
  it("preserves explicit values on a current (v9) fleet", () => {
    const f = newFleet();
    f.version = "vcf-sizer-v9";
    f.vmManagementNetwork = "Use ESX management network";
    f.vcfManagementNetwork = "Use a separate dedicated network";
    const r = migrateFleet(JSON.parse(JSON.stringify(f)));
    expect(r.vmManagementNetwork).toBe("Use ESX management network");
    expect(r.vcfManagementNetwork).toBe("Use a separate dedicated network");
  });
});
