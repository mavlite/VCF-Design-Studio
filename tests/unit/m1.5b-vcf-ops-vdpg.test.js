// @vitest-environment node
//
// M1.5b — fleet-level "Deploy VCF Ops/Auto to a specific vDPG or NSX segment"
// flag. Workbook cell verified against the pristine 9.1 fixture:
//   Deploy Management Domain!L47, dropdown ["Selected","Unselected"],
//   default "Unselected", 9.1-ONLY (absent on 9.0; on 9.0 L47 is NTP Server #1).
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const { newFleet, migrateFleet, WORKBOOK_CELL_MAP } = VcfEngine;

// The new entry is identified by its label (NOT just cell L47, which the NTP#1
// entry also uses as its 9.0 address — NTP#1 resolves to L75 on 9.1).
const vdpgEntry = WORKBOOK_CELL_MAP.find(
  (e) => /vDPG|VCF OPs and VCF Auto/i.test(e.label || "")
);

describe("M1.5b — VCF Ops/Auto vDPG flag", () => {
  it("newFleet defaults vcfOpsDeployToVdpg to false", () => {
    expect(newFleet().vcfOpsDeployToVdpg).toBe(false);
  });

  it("has a 9.1-only cell-map entry at Deploy Management Domain L47", () => {
    expect(vdpgEntry).toBeTruthy();
    expect(vdpgEntry.sheet).toBe("Deploy Management Domain");
    expect(vdpgEntry.cell).toBe("L47");
    expect(vdpgEntry.workbookVersions).toEqual(["9.1"]);
    expect(vdpgEntry.dataValidation).toEqual(["Selected", "Unselected"]);
  });

  it("resolve maps the boolean to Selected/Unselected", () => {
    expect(vdpgEntry.resolve({ vcfOpsDeployToVdpg: true }, {})).toBe("Selected");
    expect(vdpgEntry.resolve({ vcfOpsDeployToVdpg: false }, {})).toBe("Unselected");
    expect(vdpgEntry.resolve({}, {})).toBe("Unselected");
  });

  it("apply maps Selected/Unselected back to the boolean", () => {
    const f1 = {};
    vdpgEntry.apply(f1, {}, "Selected");
    expect(f1.vcfOpsDeployToVdpg).toBe(true);
    const f2 = {};
    vdpgEntry.apply(f2, {}, "Unselected");
    expect(f2.vcfOpsDeployToVdpg).toBe(false);
  });

  it("migrateFleet preserves an explicit vcfOpsDeployToVdpg value on a current (v9) fleet", () => {
    const f = newFleet();
    f.version = "vcf-sizer-v9"; // current fleets carry a version; the lossy v2/v3
                                // chain (which drops unknown top-level fields) is
                                // only for pre-9.1 imports that can't have this field.
    f.vcfOpsDeployToVdpg = true;
    const migrated = migrateFleet(JSON.parse(JSON.stringify(f)));
    expect(migrated.vcfOpsDeployToVdpg).toBe(true);
  });
});
