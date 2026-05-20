import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  APPLIANCE_DB,
  newFleet,
  newWorkloadDomain,
  cryptoKey,
  migrateFleet,
} = VcfEngine;

// ─────────────────────────────────────────────────────────────────────────────
// Plan 3 — Avi Load Balancer split into Controller (mgmt) + Service Engine (wld)
//
// Per Broadcom: "All Avi Controllers are deployed in the management domain,
// even when the Avi Load Balancer is deployed in a VI workload domain.
// Service Engines (SEs) are deployed in the workload domain in which the
// Avi Load Balancer is providing load balancing services."
// ─────────────────────────────────────────────────────────────────────────────

describe("APPLIANCE_DB — Avi split entries", () => {
  it("aviController exists with mgmt-only-greenfield constraint", () => {
    const def = APPLIANCE_DB.aviController;
    expect(def).toBeDefined();
    expect(def.placementConstraint).toBe("mgmt-only-greenfield");
    expect(def.recommendedScope).toBe("mgmt");
    expect(def.label).toMatch(/Controller/);
  });

  it("aviServiceEngine exists with wld-only constraint", () => {
    const def = APPLIANCE_DB.aviServiceEngine;
    expect(def).toBeDefined();
    expect(def.placementConstraint).toBe("wld-only");
    expect(def.recommendedScope).toBe("wld");
    expect(def.label).toMatch(/Service Engine/);
  });

  it("legacy aviLb id is retained but marked deprecated", () => {
    const def = APPLIANCE_DB.aviLb;
    expect(def).toBeDefined();
    expect(def.deprecated).toBe(true);
  });

  it("Controller and SE have distinct sizing tables", () => {
    const ctrl = APPLIANCE_DB.aviController;
    const se = APPLIANCE_DB.aviServiceEngine;
    // SE Small is much lighter than Controller Small (data plane vs control)
    expect(se.sizes.Small.vcpu).toBeLessThan(ctrl.sizes.Small.vcpu);
    expect(se.sizes.Small.ram).toBeLessThan(ctrl.sizes.Small.ram);
  });
});

describe("Profile stacks — aviLb is replaced by aviController", () => {
  it("ha profile uses aviController, not aviLb", () => {
    const stack = VcfEngine.DEPLOYMENT_PROFILES.ha.stack;
    expect(stack.some((e) => e.id === "aviController")).toBe(true);
    expect(stack.some((e) => e.id === "aviLb")).toBe(false);
  });

  it("haFederationSiteProtection profile uses aviController", () => {
    const stack = VcfEngine.DEPLOYMENT_PROFILES.haFederationSiteProtection.stack;
    expect(stack.some((e) => e.id === "aviController")).toBe(true);
    expect(stack.some((e) => e.id === "aviLb")).toBe(false);
  });
});

describe("migrateFleet — aviLb rewrite on mgmt cluster", () => {
  it("rewrites aviLb in mgmt-cluster infraStack to aviController, preserving size + instances", () => {
    const fleet = newFleet();
    const mgmt = fleet.instances[0].domains.find((d) => d.type === "mgmt");
    mgmt.clusters[0].infraStack.push({
      id: "aviLb",
      size: "Large",
      instances: 5,
      key: "k-legacy-avi",
      role: "mgmt",
    });
    const migrated = migrateFleet({ version: "vcf-sizer-v9", fleet });
    const mgmtOut = migrated.instances[0].domains.find((d) => d.type === "mgmt");
    const stack = mgmtOut.clusters[0].infraStack;
    const aviRow = stack.find((e) => e.key === "k-legacy-avi");
    expect(aviRow.id).toBe("aviController");
    expect(aviRow.size).toBe("Large");
    expect(aviRow.instances).toBe(5);
    // Mgmt cluster does not get an SE auto-injected.
    expect(stack.some((e) => e.id === "aviServiceEngine")).toBe(false);
  });
});

describe("migrateFleet — aviLb rewrite on workload domain wldStack", () => {
  it("rewrites aviLb to aviController AND appends aviServiceEngine", () => {
    const fleet = newFleet();
    const wld = newWorkloadDomain("WLD with Avi");
    wld.wldStack = [
      {
        id: "aviLb",
        size: "Small",
        instances: 3,
        key: "k-legacy-avi-wld",
        role: "wld",
        ownerDomainId: wld.id,
      },
    ];
    fleet.instances[0].domains.push(wld);
    const migrated = migrateFleet({ version: "vcf-sizer-v9", fleet });
    const wldOut = migrated.instances[0].domains.find((d) => d.id === wld.id);
    const stack = wldOut.wldStack;
    // Controller portion preserved.
    const ctrl = stack.find((e) => e.key === "k-legacy-avi-wld");
    expect(ctrl.id).toBe("aviController");
    expect(ctrl.size).toBe("Small");
    expect(ctrl.instances).toBe(3);
    // Service Engine appended, default Small × 2, scoped to this domain.
    const se = stack.find((e) => e.id === "aviServiceEngine");
    expect(se).toBeDefined();
    expect(se.size).toBe("Small");
    expect(se.instances).toBe(2);
    expect(se.ownerDomainId).toBe(wld.id);
    expect(se.role).toBe("wld");
  });

  it("does not append a second SE when one already exists (idempotency)", () => {
    const fleet = newFleet();
    const wld = newWorkloadDomain("WLD");
    wld.wldStack = [
      {
        id: "aviController",
        size: "Small",
        instances: 3,
        key: "k1",
        role: "wld",
        ownerDomainId: wld.id,
      },
      {
        id: "aviServiceEngine",
        size: "Medium",
        instances: 4,
        key: "k2",
        role: "wld",
        ownerDomainId: wld.id,
      },
    ];
    fleet.instances[0].domains.push(wld);
    const migrated = migrateFleet({ version: "vcf-sizer-v9", fleet });
    const wldOut = migrated.instances[0].domains.find((d) => d.id === wld.id);
    const ses = wldOut.wldStack.filter((e) => e.id === "aviServiceEngine");
    expect(ses).toHaveLength(1);
    expect(ses[0].instances).toBe(4); // user's value preserved
  });

  it("does not append SE when there's no Controller in the stack", () => {
    const fleet = newFleet();
    const wld = newWorkloadDomain("WLD without Avi");
    wld.wldStack = []; // empty
    fleet.instances[0].domains.push(wld);
    const migrated = migrateFleet({ version: "vcf-sizer-v9", fleet });
    const wldOut = migrated.instances[0].domains.find((d) => d.id === wld.id);
    expect(wldOut.wldStack).toHaveLength(0);
  });

  it("migration is idempotent — second pass produces identical output", () => {
    const fleet = newFleet();
    const wld = newWorkloadDomain("WLD");
    wld.wldStack = [
      { id: "aviLb", size: "Small", instances: 3, key: "k-x", role: "wld", ownerDomainId: wld.id },
    ];
    fleet.instances[0].domains.push(wld);
    const once = migrateFleet({ version: "vcf-sizer-v9", fleet });
    const twice = migrateFleet({ version: "vcf-sizer-v9", fleet: once });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
