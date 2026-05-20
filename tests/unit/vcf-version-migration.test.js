// Migration tests for VCF version support (Plan 12, PR 2).
// Covers: migrate9_0To9_1, migrate9_1To9_0, ensureVcfmsEntries,
// stripVersionExclusive, reconcileFleetVersion, reconcileInstanceVersion,
// and the migrateFleet integration (v2/v3 vcfVersion preservation, backfill).
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  migrate9_0To9_1,
  migrate9_1To9_0,
  ensureVcfmsEntries,
  stripVersionExclusive,
  reconcileFleetVersion,
  reconcileInstanceVersion,
  migrateFleet,
  newFleet,
  newInstance,
  newSite,
  newMgmtDomain,
  newWorkloadDomain,
  DEFAULT_VCF_VERSION_LEGACY,
  DEFAULT_VCF_VERSION_NEW,
} = VcfEngine;

// Build a clean 9.0-style fleet by downgrading a fresh 9.1 fleet (which
// strips VCFMS) and then deleting the vcfVersion field. Used by tests that
// need a "legacy unversioned" starting state.
function buildLegacyFleet() {
  const fleet = migrate9_1To9_0(newFleet());
  delete fleet.vcfVersion;
  return fleet;
}

// Build a multi-instance legacy fleet for scope-per-fleet tests.
function buildTwoInstanceFleet() {
  const fleet = buildLegacyFleet();
  const siteB = newSite("Site B", "");
  fleet.sites.push(siteB);
  // newInstance with default vcfVersion produces a 9.0-style instance.
  const inst2 = newInstance("inst-2", [siteB.id]);
  fleet.instances.push(inst2);
  return fleet;
}

describe("ensureVcfmsEntries — append-only helper", () => {
  it("adds vcfmsControl and vcfmsWorker when both missing", () => {
    const next = ensureVcfmsEntries([]);
    const ids = next.map((e) => e.id).sort();
    expect(ids).toContain("vcfmsControl");
    expect(ids).toContain("vcfmsWorker");
  });

  it("preserves existing vcfmsControl with custom size (idempotent)", () => {
    const existing = [{ id: "vcfmsControl", size: "Large", instances: 3 }];
    const next = ensureVcfmsEntries(existing);
    const ctrl = next.find((e) => e.id === "vcfmsControl");
    expect(ctrl.size).toBe("Large");
    expect(ctrl.instances).toBe(3);
    // Worker still added since it was missing.
    expect(next.some((e) => e.id === "vcfmsWorker")).toBe(true);
  });

  it("does not duplicate when both entries already present", () => {
    const existing = [
      { id: "vcfmsControl", size: "Medium", instances: 3 },
      { id: "vcfmsWorker",  size: "Large",  instances: 4 },
    ];
    const next = ensureVcfmsEntries(existing);
    expect(next.filter((e) => e.id === "vcfmsControl").length).toBe(1);
    expect(next.filter((e) => e.id === "vcfmsWorker").length).toBe(1);
  });

  it("preserves other stack entries unchanged", () => {
    const existing = [{ id: "vcenter", size: "Medium", instances: 1 }];
    const next = ensureVcfmsEntries(existing);
    const vc = next.find((e) => e.id === "vcenter");
    expect(vc).toEqual({ id: "vcenter", size: "Medium", instances: 1 });
  });

  it("safely accepts null/undefined input", () => {
    expect(() => ensureVcfmsEntries(null)).not.toThrow();
    expect(() => ensureVcfmsEntries(undefined)).not.toThrow();
  });
});

describe("stripVersionExclusive — filter helper", () => {
  it("strips VCFMS entries when targeting 9.0", () => {
    const stack = [
      { id: "vcenter",      size: "Medium", instances: 1 },
      { id: "vcfmsControl", size: "Medium", instances: 3 },
      { id: "vcfmsWorker",  size: "Medium", instances: 3 },
    ];
    const next = stripVersionExclusive(stack, "9.0");
    expect(next.map((e) => e.id)).toEqual(["vcenter"]);
  });

  it("preserves VCFMS entries when targeting 9.1", () => {
    const stack = [
      { id: "vcenter",      size: "Medium", instances: 1 },
      { id: "vcfmsControl", size: "Medium", instances: 3 },
    ];
    const next = stripVersionExclusive(stack, "9.1");
    expect(next.map((e) => e.id).sort()).toEqual(["vcenter", "vcfmsControl"]);
  });

  it("returns empty array for null/undefined stack", () => {
    expect(stripVersionExclusive(null, "9.0")).toEqual([]);
    expect(stripVersionExclusive(undefined, "9.1")).toEqual([]);
  });
});

describe("migrate9_0To9_1 — up-migration", () => {
  it("sets vcfVersion to '9.1'", () => {
    const fleet = buildLegacyFleet();
    const next = migrate9_0To9_1(fleet);
    expect(next.vcfVersion).toBe("9.1");
  });

  it("returns input unchanged if already 9.1", () => {
    const fleet = newFleet();
    fleet.vcfVersion = "9.1";
    const next = migrate9_0To9_1(fleet);
    expect(next).toBe(fleet);
  });

  it("injects VCFMS into the initial instance's mgmt cluster infraStack", () => {
    const fleet = buildLegacyFleet();
    const next = migrate9_0To9_1(fleet);
    const initialMgmt = next.instances[0].domains.find((d) => d.type === "mgmt");
    const infra = initialMgmt.clusters[0].infraStack || [];
    const ids = infra.map((e) => e.id);
    expect(ids).toContain("vcfmsControl");
    expect(ids).toContain("vcfmsWorker");
  });

  it("does NOT inject VCFMS into secondary instances (scope:per-fleet)", () => {
    const fleet = buildTwoInstanceFleet();
    const next = migrate9_0To9_1(fleet);
    // Secondary instance (index 1) should have no VCFMS in any mgmt cluster.
    const secondary = next.instances[1];
    for (const dom of secondary.domains) {
      if (dom.type !== "mgmt") continue;
      for (const clu of dom.clusters) {
        const ids = (clu.infraStack || []).map((e) => e.id);
        expect(ids).not.toContain("vcfmsControl");
        expect(ids).not.toContain("vcfmsWorker");
      }
    }
  });

  it("is idempotent on a 9.1 fleet with VCFMS already present", () => {
    const once = migrate9_0To9_1({ ...newFleet(), vcfVersion: undefined });
    const twice = migrate9_0To9_1(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("preserves user-customized VCFMS sizes (append-only)", () => {
    // Start from a legacy 9.0 fleet (no VCFMS), then user pre-added VCFMS
    // entries with custom sizing before upgrading. migrate9_0To9_1 must NOT
    // overwrite those entries.
    const fleet = buildLegacyFleet();
    const mgmtDom = fleet.instances[0].domains.find((d) => d.type === "mgmt");
    mgmtDom.clusters[0].infraStack = [
      ...(mgmtDom.clusters[0].infraStack || []),
      { id: "vcfmsControl", size: "Large",  instances: 3 },
      { id: "vcfmsWorker", size: "Large", instances: 4 },
    ];
    const next = migrate9_0To9_1(fleet);
    const infra = next.instances[0].domains.find((d) => d.type === "mgmt").clusters[0].infraStack;
    const workers = infra.filter((e) => e.id === "vcfmsWorker");
    expect(workers.length).toBe(1); // no duplicate
    expect(workers[0].size).toBe("Large");
    expect(workers[0].instances).toBe(4);
    const controls = infra.filter((e) => e.id === "vcfmsControl");
    expect(controls.length).toBe(1);
    expect(controls[0].size).toBe("Large");
  });

  it("does not crash on fleet with empty instances array", () => {
    const fleet = { vcfVersion: undefined, instances: [] };
    const next = migrate9_0To9_1(fleet);
    expect(next.vcfVersion).toBe("9.1");
    expect(next.instances).toEqual([]);
  });

  it("does not crash on fleet with undefined instances", () => {
    const fleet = { vcfVersion: undefined };
    const next = migrate9_0To9_1(fleet);
    expect(next.vcfVersion).toBe("9.1");
  });
});

describe("migrate9_1To9_0 — down-migration (destructive)", () => {
  it("sets vcfVersion to '9.0'", () => {
    const fleet = migrate9_0To9_1({ ...newFleet(), vcfVersion: undefined });
    const next = migrate9_1To9_0(fleet);
    expect(next.vcfVersion).toBe("9.0");
  });

  it("returns input unchanged if already 9.0", () => {
    const fleet = newFleet();
    fleet.vcfVersion = "9.0";
    const next = migrate9_1To9_0(fleet);
    expect(next).toBe(fleet);
  });

  it("strips VCFMS entries from initial instance's mgmt cluster", () => {
    const fleet = migrate9_0To9_1({ ...newFleet(), vcfVersion: undefined });
    const next = migrate9_1To9_0(fleet);
    const initialMgmt = next.instances[0].domains.find((d) => d.type === "mgmt");
    const ids = (initialMgmt.clusters[0].infraStack || []).map((e) => e.id);
    expect(ids).not.toContain("vcfmsControl");
    expect(ids).not.toContain("vcfmsWorker");
  });

  it("strips VCFMS entries from secondary instances that contain them (defense in depth)", () => {
    // Build a fleet where a secondary instance has manually-placed VCFMS.
    const fleet = migrate9_0To9_1(buildTwoInstanceFleet());
    // Manually inject VCFMS into secondary mgmt cluster (simulates a hand-edit
    // or future migration bug).
    const secondaryMgmt = fleet.instances[1].domains.find((d) => d.type === "mgmt");
    if (secondaryMgmt) {
      secondaryMgmt.clusters[0].infraStack = [
        ...(secondaryMgmt.clusters[0].infraStack || []),
        { id: "vcfmsControl", size: "Medium", instances: 3 },
      ];
    }
    const next = migrate9_1To9_0(fleet);
    for (const inst of next.instances) {
      for (const dom of inst.domains) {
        for (const clu of dom.clusters || []) {
          const ids = (clu.infraStack || []).map((e) => e.id);
          expect(ids).not.toContain("vcfmsControl");
          expect(ids).not.toContain("vcfmsWorker");
        }
      }
    }
  });

  it("is idempotent on a 9.0 fleet", () => {
    const fleet = migrate9_1To9_0(migrate9_0To9_1({ ...newFleet(), vcfVersion: undefined }));
    const twice = migrate9_1To9_0(fleet);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(fleet));
  });

  it("does not crash on empty / undefined instances", () => {
    expect(() => migrate9_1To9_0({ vcfVersion: "9.1", instances: [] })).not.toThrow();
    expect(() => migrate9_1To9_0({ vcfVersion: "9.1" })).not.toThrow();
  });
});

describe("round-trip 9.1 → 9.0 → 9.1", () => {
  it("restores VCFMS at default sizes (customizations are lost by design)", () => {
    const fleet = buildLegacyFleet();
    const up = migrate9_0To9_1(fleet);
    // Customize the worker pool
    const mgmt = up.instances[0].domains.find((d) => d.type === "mgmt");
    mgmt.clusters[0].infraStack = mgmt.clusters[0].infraStack.map((e) =>
      e.id === "vcfmsWorker" ? { ...e, size: "Large", instances: 4 } : e
    );
    const down = migrate9_1To9_0(up);
    const reup = migrate9_0To9_1(down);
    const reupInfra = reup.instances[0].domains.find((d) => d.type === "mgmt").clusters[0].infraStack;
    const worker = reupInfra.find((e) => e.id === "vcfmsWorker");
    // Defaults restored (Medium / 3) — customizations did NOT survive.
    expect(worker.size).toBe("Medium");
    expect(worker.instances).toBe(3);
  });
});

describe("reconcileFleetVersion — defense-in-depth invariant enforcer", () => {
  it("strips VCFMS entries when version is 9.0", () => {
    const fleet = migrate9_0To9_1({ ...newFleet(), vcfVersion: undefined });
    // Force version to 9.0 but VCFMS still in the stack (simulates hand-edited JSON).
    fleet.vcfVersion = "9.0";
    const next = reconcileFleetVersion(fleet);
    expect(next.vcfVersion).toBe("9.0");
    const mgmt = next.instances[0].domains.find((d) => d.type === "mgmt");
    const ids = (mgmt.clusters[0].infraStack || []).map((e) => e.id);
    expect(ids).not.toContain("vcfmsControl");
  });

  it("injects VCFMS when version is 9.1 but entries missing", () => {
    // Hand-edited fleet: vcfVersion says 9.1 but mgmt stack has no VCFMS.
    const fleet = newFleet();
    fleet.vcfVersion = "9.1";
    const next = reconcileFleetVersion(fleet);
    const mgmt = next.instances[0].domains.find((d) => d.type === "mgmt");
    const ids = (mgmt.clusters[0].infraStack || []).map((e) => e.id);
    expect(ids).toContain("vcfmsControl");
    expect(ids).toContain("vcfmsWorker");
  });

  it("backfills missing vcfVersion to DEFAULT_VCF_VERSION_LEGACY", () => {
    const fleet = buildLegacyFleet();
    const next = reconcileFleetVersion(fleet);
    expect(next.vcfVersion).toBe(DEFAULT_VCF_VERSION_LEGACY);
  });

  it("safely handles null / undefined input", () => {
    expect(reconcileFleetVersion(null)).toBeNull();
    expect(reconcileFleetVersion(undefined)).toBeUndefined();
  });
});

describe("reconcileInstanceVersion — per-instance migration helper", () => {
  it("returns instance unchanged when versions match", () => {
    const inst = newInstance("inst-1", []);
    inst.vcfVersion = "9.1";
    const next = reconcileInstanceVersion(inst, "9.1");
    expect(next).toBe(inst);
  });

  it("migrates a 9.0 instance up to 9.1 (adds VCFMS to mgmt cluster)", () => {
    const inst = newInstance("inst-1", []);
    inst.vcfVersion = "9.0";
    const next = reconcileInstanceVersion(inst, "9.1");
    const mgmt = next.domains.find((d) => d.type === "mgmt");
    const ids = (mgmt.clusters[0].infraStack || []).map((e) => e.id);
    expect(ids).toContain("vcfmsControl");
  });

  it("migrates a 9.1 instance down to 9.0 (strips VCFMS)", () => {
    const inst = newInstance("inst-1", []);
    inst.vcfVersion = "9.0";
    const up = reconcileInstanceVersion(inst, "9.1");
    const down = reconcileInstanceVersion(up, "9.0");
    const mgmt = down.domains.find((d) => d.type === "mgmt");
    const ids = (mgmt.clusters[0].infraStack || []).map((e) => e.id);
    expect(ids).not.toContain("vcfmsControl");
    expect(ids).not.toContain("vcfmsWorker");
  });

  it("safely handles null / undefined input", () => {
    expect(reconcileInstanceVersion(null, "9.1")).toBeNull();
    expect(reconcileInstanceVersion(undefined, "9.1")).toBeUndefined();
  });
});

describe("migrateFleet — vcfVersion backfill and preservation", () => {
  it("backfills vcfVersion to '9.0' on legacy unversioned imports", () => {
    // Construct a v5-shaped legacy import (no vcfVersion field, no VCFMS).
    const v5 = buildLegacyFleet();
    const raw = { version: "vcf-sizer-v5", fleet: v5 };
    const next = migrateFleet(raw);
    expect(next.vcfVersion).toBe("9.0");
  });

  it("preserves explicit vcfVersion: '9.1' through the v5 path", () => {
    const v5 = newFleet(); // defaults to vcfVersion: "9.1"
    const raw = { version: "vcf-sizer-v5", fleet: v5 };
    const next = migrateFleet(raw);
    expect(next.vcfVersion).toBe("9.1");
  });

  it("preserves vcfVersion across the v2/v3 chain (snapshot+restore)", () => {
    // Construct a minimal v3-shaped fleet with vcfVersion set top-level.
    // The v2→v3→v5→v6 chain returns literal objects that drop unknown keys;
    // migrateFleet must restore vcfVersion from the raw input snapshot.
    const v3 = {
      version: "vcf-sizer-v3",
      vcfVersion: "9.1",
      fleet: {
        id: "f1",
        name: "Test",
        sites: [{ id: "s1", name: "Site 1", location: "" }],
        instances: [{
          id: "i1",
          name: "Instance 1",
          siteIds: ["s1"],
          domains: [],
        }],
      },
    };
    const next = migrateFleet(v3);
    expect(next.vcfVersion).toBe("9.1");
  });

  it("is idempotent across two migrateFleet calls on an unversioned legacy fleet", () => {
    const v5 = buildLegacyFleet();
    const once = migrateFleet({ version: "vcf-sizer-v5", fleet: v5 });
    const twice = migrateFleet({ version: "vcf-sizer-v5", fleet: once });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("does NOT auto-migrate legacy fleets up to 9.1 (must be explicit)", () => {
    // Guard test: a regression where migrate9_0To9_1 fires unconditionally
    // would cause every legacy fleet to gain VCFMS entries on import. This
    // test catches that.
    const v5 = buildLegacyFleet();
    const next = migrateFleet({ version: "vcf-sizer-v5", fleet: v5 });
    expect(next.vcfVersion).toBe("9.0"); // not "9.1"
    // And the mgmt stack should NOT contain VCFMS entries.
    const mgmt = next.instances[0].domains.find((d) => d.type === "mgmt");
    const ids = (mgmt.clusters[0].infraStack || []).map((e) => e.id);
    expect(ids).not.toContain("vcfmsControl");
    expect(ids).not.toContain("vcfmsWorker");
  });

  it("round-trip JSON: serialize 9.1 fleet → migrateFleet preserves vcfVersion and VCFMS", () => {
    const fleet = migrate9_0To9_1({ ...newFleet(), vcfVersion: undefined });
    const serialized = JSON.stringify({ version: "vcf-sizer-v6", fleet });
    const reimported = migrateFleet(JSON.parse(serialized));
    expect(reimported.vcfVersion).toBe("9.1");
    const mgmt = reimported.instances[0].domains.find((d) => d.type === "mgmt");
    const ids = (mgmt.clusters[0].infraStack || []).map((e) => e.id);
    expect(ids).toContain("vcfmsControl");
    expect(ids).toContain("vcfmsWorker");
  });
});

describe("newFleet — factory sets default vcfVersion", () => {
  it("new fleet has vcfVersion = DEFAULT_VCF_VERSION_NEW (9.1)", () => {
    const fleet = newFleet();
    expect(fleet.vcfVersion).toBe(DEFAULT_VCF_VERSION_NEW);
    expect(fleet.vcfVersion).toBe("9.1");
  });

  it("new fleet's initial mgmt cluster has VCFMS in its infraStack (9.1)", () => {
    const fleet = newFleet();
    const mgmt = fleet.instances[0].domains.find((d) => d.type === "mgmt");
    const ids = (mgmt.clusters[0].infraStack || []).map((e) => e.id);
    expect(ids).toContain("vcfmsControl");
    expect(ids).toContain("vcfmsWorker");
  });
});
