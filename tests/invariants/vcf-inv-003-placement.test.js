import { describe, it, expect } from "vitest";
import fc from "fast-check";
import VcfEngine from "../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  cryptoKey,
  validatePlacementConstraints,
  APPLIANCE_DB,
} = VcfEngine;

// ─────────────────────────────────────────────────────────────────────────────
// Plan 5 / VCF-INV-003 — placement-constraint validator
//
// Flags an issue per workload-domain wldStack entry that:
//   1. Has placementConstraint === "mgmt-only-greenfield" (vCenter, NSX
//      Manager, Avi Controller — see Plan 2)
//   2. Resolves to a workload-domain cluster (entry.placementClusterId or
//      domain.componentsClusterId points inside this WLD)
//   3. The owning domain is NOT imported (brownfield exception, Plan 4)
//
// nsxEdge entries are flexible by Broadcom rule and never flagged.
// ─────────────────────────────────────────────────────────────────────────────

function buildFleet({ imported, vcenterTarget, applianceId = "vcenter" }) {
  const fleet = newFleet();
  const inst = fleet.instances[0];
  const mgmt = inst.domains.find((d) => d.type === "mgmt");
  const wld = newWorkloadDomain("WLD");
  wld.imported = imported;
  inst.domains.push(wld);
  // pick the resolution target by name
  let targetId;
  if (vcenterTarget === "mgmt") targetId = mgmt.clusters[0].id;
  else if (vcenterTarget === "wld") targetId = wld.clusters[0].id;
  wld.componentsClusterId = targetId;
  wld.wldStack = [
    {
      id: applianceId,
      size: APPLIANCE_DB[applianceId].defaultSize,
      instances: 1,
      key: cryptoKey(),
      role: "wld",
      placementClusterId: null,
      ownerDomainId: wld.id,
    },
  ];
  return { fleet, inst, mgmt, wld };
}

describe("VCF-INV-003 — flags workload-domain placement of mgmt-only-greenfield appliances", () => {
  it("greenfield WLD with vCenter on WLD cluster → 1 critical issue", () => {
    const { fleet, wld } = buildFleet({ imported: false, vcenterTarget: "wld" });
    const issues = validatePlacementConstraints(fleet);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe("VCF-INV-003");
    expect(issues[0].severity).toBe("critical");
    expect(issues[0].domainId).toBe(wld.id);
    expect(issues[0].message).toMatch(/management-domain cluster/);
  });

  it("greenfield WLD with vCenter on mgmt cluster → 0 issues", () => {
    const { fleet } = buildFleet({ imported: false, vcenterTarget: "mgmt" });
    const issues = validatePlacementConstraints(fleet);
    expect(issues).toHaveLength(0);
  });

  it("greenfield WLD with NSX Manager on WLD cluster → 1 critical issue", () => {
    const { fleet } = buildFleet({ imported: false, vcenterTarget: "wld", applianceId: "nsxMgr" });
    const issues = validatePlacementConstraints(fleet);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe("VCF-INV-003");
  });

  it("greenfield WLD with Avi Controller on WLD cluster → 1 critical issue", () => {
    const { fleet } = buildFleet({ imported: false, vcenterTarget: "wld", applianceId: "aviLb" });
    const issues = validatePlacementConstraints(fleet);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe("VCF-INV-003");
  });
});

describe("VCF-INV-003 — does NOT flag flexible appliances (NSX Edge)", () => {
  it("NSX Edge on WLD cluster → 0 issues", () => {
    const { fleet } = buildFleet({ imported: false, vcenterTarget: "wld", applianceId: "nsxEdge" });
    const issues = validatePlacementConstraints(fleet);
    expect(issues).toHaveLength(0);
  });

  it("NSX Edge on mgmt cluster → 0 issues", () => {
    const { fleet } = buildFleet({ imported: false, vcenterTarget: "mgmt", applianceId: "nsxEdge" });
    const issues = validatePlacementConstraints(fleet);
    expect(issues).toHaveLength(0);
  });
});

describe("VCF-INV-003 — imported (brownfield) domains are exempt", () => {
  it("imported WLD with vCenter on WLD cluster → 0 issues (brownfield exception)", () => {
    const { fleet } = buildFleet({ imported: true, vcenterTarget: "wld" });
    const issues = validatePlacementConstraints(fleet);
    expect(issues).toHaveLength(0);
  });

  it("imported WLD with NSX Manager on WLD cluster → 0 issues", () => {
    const { fleet } = buildFleet({ imported: true, vcenterTarget: "wld", applianceId: "nsxMgr" });
    const issues = validatePlacementConstraints(fleet);
    expect(issues).toHaveLength(0);
  });
});

describe("VCF-INV-003 — per-entry placementClusterId override", () => {
  it("vCenter pinned to WLD cluster via per-entry override is flagged", () => {
    const { fleet, mgmt, wld } = buildFleet({ imported: false, vcenterTarget: "mgmt" });
    // domain default is mgmt; per-entry override forces WLD.
    wld.wldStack[0].placementClusterId = wld.clusters[0].id;
    const issues = validatePlacementConstraints(fleet);
    expect(issues).toHaveLength(1);
  });

  it("vCenter with stale per-entry override + mgmt domain default → 0 issues (falls back to mgmt)", () => {
    const { fleet, wld } = buildFleet({ imported: false, vcenterTarget: "mgmt" });
    wld.wldStack[0].placementClusterId = "clu-DOES-NOT-EXIST";
    // Validator uses entry.placementClusterId || dom.componentsClusterId.
    // Since "clu-DOES-NOT-EXIST" is truthy, validator uses it as targetId,
    // but it doesn't match mgmt OR wld cluster ids → no flag.
    const issues = validatePlacementConstraints(fleet);
    expect(issues).toHaveLength(0);
  });
});

describe("VCF-INV-003 — empty/edge cases", () => {
  it("empty fleet → 0 issues", () => {
    expect(validatePlacementConstraints({ instances: [] })).toEqual([]);
    expect(validatePlacementConstraints({})).toEqual([]);
    expect(validatePlacementConstraints(null)).toEqual([]);
  });

  it("instance with only mgmt domain → 0 issues", () => {
    const fleet = newFleet();
    const issues = validatePlacementConstraints(fleet);
    expect(issues).toHaveLength(0);
  });

  it("WLD with empty wldStack → 0 issues", () => {
    const fleet = newFleet();
    const wld = newWorkloadDomain("WLD");
    fleet.instances[0].domains.push(wld);
    const issues = validatePlacementConstraints(fleet);
    expect(issues).toHaveLength(0);
  });

  it("VKS Supervisor (wld-only) is never flagged", () => {
    const { fleet, wld } = buildFleet({ imported: false, vcenterTarget: "wld", applianceId: "vksSupervisor" });
    const issues = validatePlacementConstraints(fleet);
    expect(issues).toHaveLength(0);
  });
});

describe("VCF-INV-003 — property: emitted issues only target mgmt-only-greenfield apps in non-imported domains", () => {
  it("never emits an issue for nsxEdge / vksSupervisor / imported domains", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            applianceId: fc.constantFrom("vcenter", "nsxMgr", "aviLb", "nsxEdge", "vksSupervisor"),
            target: fc.constantFrom("mgmt", "wld"),
            imported: fc.boolean(),
          }),
          { minLength: 1, maxLength: 6 }
        ),
        (configs) => {
          const fleet = newFleet();
          const inst = fleet.instances[0];
          const mgmt = inst.domains.find((d) => d.type === "mgmt");
          for (const cfg of configs) {
            const wld = newWorkloadDomain(`WLD-${cryptoKey()}`);
            wld.imported = cfg.imported;
            wld.componentsClusterId = cfg.target === "mgmt" ? mgmt.clusters[0].id : wld.clusters[0].id;
            wld.wldStack = [
              {
                id: cfg.applianceId,
                size: APPLIANCE_DB[cfg.applianceId].defaultSize,
                instances: 1,
                key: cryptoKey(),
                role: "wld",
                placementClusterId: null,
                ownerDomainId: wld.id,
              },
            ];
            inst.domains.push(wld);
          }
          const issues = validatePlacementConstraints(fleet);
          for (const issue of issues) {
            const dom = inst.domains.find((d) => d.id === issue.domainId);
            expect(dom).toBeDefined();
            expect(dom.imported).toBe(false);
            const entry = dom.wldStack.find((e) => e.key === issue.entryKey);
            expect(entry).toBeDefined();
            expect(APPLIANCE_DB[entry.id].placementConstraint).toBe("mgmt-only-greenfield");
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
