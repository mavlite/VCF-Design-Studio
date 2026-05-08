import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  newWorkloadDomain,
  newMgmtDomain,
  newInstance,
  newSite,
  newFleet,
  migrateFleet,
} = VcfEngine;

// ─────────────────────────────────────────────────────────────────────────────
// Plan 4 / VCF-PATH-004 — domain.imported flag
//
// Background: Broadcom VCF 9 places workload-domain vCenter and NSX Manager
// VMs on management-domain hosts (VCF-INV-003). The only path to running
// those VMs on workload-domain hosts is the brownfield import workflow
// (VCF-PATH-004). The `imported` flag distinguishes the two cases per
// workload domain so a single fleet can mix imported + greenfield WLDs.
// ─────────────────────────────────────────────────────────────────────────────

describe("VCF-PATH-004 — newWorkloadDomain factory", () => {
  it("defaults imported to false (greenfield)", () => {
    const d = newWorkloadDomain("WLD");
    expect(d.imported).toBe(false);
  });

  it("does not set imported on management domains", () => {
    const m = newMgmtDomain("MGMT");
    expect(m.imported).toBeUndefined();
  });

  it("preserves imported across factory calls (no shared mutation)", () => {
    const a = newWorkloadDomain("A");
    a.imported = true;
    const b = newWorkloadDomain("B");
    expect(b.imported).toBe(false);
  });
});

describe("VCF-PATH-004 — migrateFleet preserves explicit imported flag", () => {
  it("preserves imported=true on round-trip", () => {
    const fleet = newFleet();
    const wld = newWorkloadDomain("Imported WLD");
    wld.imported = true;
    fleet.instances[0].domains.push(wld);
    const migrated = migrateFleet({ version: "vcf-sizer-v6", fleet });
    const wldOut = migrated.instances[0].domains.find((d) => d.id === wld.id);
    expect(wldOut.imported).toBe(true);
  });

  it("preserves imported=false on round-trip", () => {
    const fleet = newFleet();
    const wld = newWorkloadDomain("Greenfield WLD");
    wld.imported = false;
    fleet.instances[0].domains.push(wld);
    const migrated = migrateFleet({ version: "vcf-sizer-v6", fleet });
    const wldOut = migrated.instances[0].domains.find((d) => d.id === wld.id);
    expect(wldOut.imported).toBe(false);
  });

  it("is idempotent — second migration produces identical output", () => {
    const fleet = newFleet();
    const wld = newWorkloadDomain("WLD");
    wld.imported = true;
    fleet.instances[0].domains.push(wld);
    const once = migrateFleet({ version: "vcf-sizer-v6", fleet });
    const twice = migrateFleet({ version: "vcf-sizer-v6", fleet: once });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe("VCF-PATH-004 — migrateFleet auto-detect from deploymentPathway", () => {
  it("marks all WLDs imported when fleet.deploymentPathway === 'import'", () => {
    const fleet = newFleet();
    fleet.deploymentPathway = "import";
    // Add 2 workload domains with no explicit imported flag.
    const a = newWorkloadDomain("A");
    const b = newWorkloadDomain("B");
    delete a.imported;
    delete b.imported;
    fleet.instances[0].domains.push(a, b);
    const migrated = migrateFleet({ version: "vcf-sizer-v6", fleet });
    const wlds = migrated.instances[0].domains.filter((d) => d.type === "workload");
    expect(wlds).toHaveLength(2);
    expect(wlds.every((d) => d.imported === true)).toBe(true);
  });

  it("greenfield pathway → WLDs default imported=false", () => {
    const fleet = newFleet();
    fleet.deploymentPathway = "greenfield";
    const wld = newWorkloadDomain("WLD");
    delete wld.imported;
    fleet.instances[0].domains.push(wld);
    const migrated = migrateFleet({ version: "vcf-sizer-v6", fleet });
    const wldOut = migrated.instances[0].domains.find((d) => d.id === wld.id);
    expect(wldOut.imported).toBe(false);
  });

  it("expand pathway → WLDs default imported=false", () => {
    const fleet = newFleet();
    fleet.deploymentPathway = "expand";
    const wld = newWorkloadDomain("WLD");
    delete wld.imported;
    fleet.instances[0].domains.push(wld);
    const migrated = migrateFleet({ version: "vcf-sizer-v6", fleet });
    const wldOut = migrated.instances[0].domains.find((d) => d.id === wld.id);
    expect(wldOut.imported).toBe(false);
  });

  it("explicit imported=false survives even when fleet pathway is 'import'", () => {
    const fleet = newFleet();
    fleet.deploymentPathway = "import";
    const wld = newWorkloadDomain("Greenfield-on-Imported-Fleet");
    wld.imported = false;
    fleet.instances[0].domains.push(wld);
    const migrated = migrateFleet({ version: "vcf-sizer-v6", fleet });
    const wldOut = migrated.instances[0].domains.find((d) => d.id === wld.id);
    expect(wldOut.imported).toBe(false);
  });
});

describe("VCF-PATH-004 — migrateFleet auto-detect from componentsClusterId", () => {
  it("flags WLDs as imported when componentsClusterId points at a WLD cluster", () => {
    // Build a legacy fleet where a workload domain has its components pinned
    // on its OWN cluster — only legal under the old permissive model.
    const fleet = newFleet();
    fleet.deploymentPathway = "greenfield";
    const wld = newWorkloadDomain("Legacy WLD");
    delete wld.imported;
    // Pin componentsClusterId at this WLD's first cluster.
    wld.componentsClusterId = wld.clusters[0].id;
    fleet.instances[0].domains.push(wld);
    const migrated = migrateFleet({ version: "vcf-sizer-v6", fleet });
    const wldOut = migrated.instances[0].domains.find((d) => d.id === wld.id);
    expect(wldOut.imported).toBe(true);
  });

  it("does NOT flag WLDs whose componentsClusterId points at a mgmt cluster", () => {
    const fleet = newFleet();
    fleet.deploymentPathway = "greenfield";
    const mgmt = fleet.instances[0].domains.find((d) => d.type === "mgmt");
    const wld = newWorkloadDomain("Standard WLD");
    delete wld.imported;
    wld.componentsClusterId = mgmt.clusters[0].id;
    fleet.instances[0].domains.push(wld);
    const migrated = migrateFleet({ version: "vcf-sizer-v6", fleet });
    const wldOut = migrated.instances[0].domains.find((d) => d.id === wld.id);
    expect(wldOut.imported).toBe(false);
  });

  it("auto-detection only fires once — second migration leaves imported=true and clears the transient banner marker", () => {
    const fleet = newFleet();
    const wld = newWorkloadDomain("WLD");
    delete wld.imported;
    wld.componentsClusterId = wld.clusters[0].id;
    fleet.instances[0].domains.push(wld);
    const once = migrateFleet({ version: "vcf-sizer-v6", fleet });
    const twice = migrateFleet({ version: "vcf-sizer-v6", fleet: once });
    const onceWld = once.instances[0].domains.find((d) => d.id === wld.id);
    const twiceWld = twice.instances[0].domains.find((d) => d.id === wld.id);
    expect(onceWld.imported).toBe(true);
    expect(twiceWld.imported).toBe(true);
    // First migration emits the banner marker; second migration does not
    // re-fire the heuristic so the marker is cleared (one-shot signal).
    expect(once._migrated?.autoImportedDomains).toHaveLength(1);
    expect(once._migrated.autoImportedDomains[0].id).toBe(wld.id);
    expect(twice._migrated).toBeUndefined();
    // Excluding the transient marker, the fleet shape is stable.
    const stripMigrated = ({ _migrated, ...rest }) => rest;
    expect(JSON.stringify(stripMigrated(twice))).toBe(JSON.stringify(stripMigrated(once)));
  });
});

describe("VCF-PATH-004 — mixed imported and greenfield WLDs", () => {
  it("a single fleet can carry both imported and greenfield workload domains", () => {
    const fleet = newFleet();
    fleet.deploymentPathway = "expand";
    const greenfield = newWorkloadDomain("Greenfield WLD");
    const imported = newWorkloadDomain("Imported WLD");
    imported.imported = true;
    fleet.instances[0].domains.push(greenfield, imported);
    const migrated = migrateFleet({ version: "vcf-sizer-v6", fleet });
    const wlds = migrated.instances[0].domains.filter((d) => d.type === "workload");
    const g = wlds.find((d) => d.id === greenfield.id);
    const i = wlds.find((d) => d.id === imported.id);
    expect(g.imported).toBe(false);
    expect(i.imported).toBe(true);
  });
});

describe("VCF-PATH-004 — v3 fixtures migrate without imported set", () => {
  it("v3 → v6 migration backfills imported=false on workload domains", () => {
    // Synthesize a minimal v3-shape fleet (no version field, sites→instances→domains)
    const v3 = {
      id: "fleet-v3",
      name: "V3 Fleet",
      sites: [
        {
          id: "site-1",
          name: "Primary",
          location: "",
          instances: [
            {
              id: "inst-1",
              name: "vcf-instance-01",
              deploymentProfile: "ha",
              domains: [
                {
                  id: "dom-mgmt",
                  type: "mgmt",
                  name: "Management Domain",
                  clusters: [{ id: "clu-mgmt-1", name: "mgmt", isDefault: true, infraStack: [], host: {}, workload: {} }],
                },
                {
                  id: "dom-wld",
                  type: "workload",
                  name: "Workload",
                  clusters: [{ id: "clu-wld-1", name: "wld", isDefault: true, infraStack: [], host: {}, workload: {} }],
                },
              ],
            },
          ],
        },
      ],
    };
    const migrated = migrateFleet(v3);
    const wld = migrated.instances[0].domains.find((d) => d.type === "workload");
    expect(wld.imported).toBe(false);
  });
});
