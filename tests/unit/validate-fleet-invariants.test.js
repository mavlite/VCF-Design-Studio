// Validator tests for validateFleetInvariants — Phase A (8 mechanical rules).
//
// Two complementary guards per rule:
//   1. NO FALSE POSITIVES: every pristine v5 fixture must validate clean
//      (asserted once, fleet-wide, at the bottom).
//   2. DETECTION: a fleet deliberately mutated to break the invariant must
//      emit an issue carrying the rule id.
//
// The existing placement-rules.test.js proves the *fixtures* comply; these
// tests prove the *engine* catches a user who builds something non-compliant.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import VcfEngine from "../../engine.js";

const { migrateFleet, getInitialInstance, validateFleetInvariants } = VcfEngine;

const FIXTURES = path.resolve(__dirname, "../../test-fixtures/v5");
const fixtureFiles = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));

function load(file) {
  return migrateFleet(JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8")));
}
function clone(fleet) {
  return structuredClone(fleet);
}
function mgmtCluster(inst) {
  return inst.domains.find((d) => d.type === "mgmt").clusters[0];
}
function idsOf(issues) {
  return issues.map((i) => i.ruleId);
}

describe("validateFleetInvariants — export + shape", () => {
  it("is exported as a function returning an array", () => {
    expect(typeof validateFleetInvariants).toBe("function");
    expect(Array.isArray(validateFleetInvariants(load("minimal-simple.json")))).toBe(true);
  });

  it("tolerates empty / malformed input without throwing", () => {
    expect(validateFleetInvariants(undefined)).toEqual([]);
    expect(validateFleetInvariants({})).toEqual([]);
    expect(validateFleetInvariants({ instances: [] })).toEqual([]);
  });

  it("every issue carries ruleId + severity + message", () => {
    const f = clone(load("multi-instance-2.json"));
    f.instances[0].domains.push({ type: "mgmt", name: "extra mgmt", clusters: [] });
    for (const iss of validateFleetInvariants(f)) {
      expect(iss.ruleId).toMatch(/^VCF-INV-/);
      expect(["critical", "warn"]).toContain(iss.severity);
      expect(typeof iss.message).toBe("string");
      expect(iss.message.length).toBeGreaterThan(0);
    }
  });
});

describe("VCF-INV-001: exactly one mgmt domain per instance", () => {
  it("fires when an instance has two mgmt domains", () => {
    const f = clone(load("multi-instance-2.json"));
    f.instances[0].domains.push({ type: "mgmt", name: "extra mgmt", clusters: [] });
    expect(idsOf(validateFleetInvariants(f))).toContain("VCF-INV-001");
  });
  it("fires when an instance has zero mgmt domains", () => {
    const f = clone(load("multi-instance-2.json"));
    f.instances[1].domains = f.instances[1].domains.filter((d) => d.type !== "mgmt");
    expect(idsOf(validateFleetInvariants(f))).toContain("VCF-INV-001");
  });
});

describe("VCF-INV-010: per-fleet appliances appear at most once (active)", () => {
  it("fires when a per-fleet appliance is duplicated onto a second instance", () => {
    const f = clone(load("multi-instance-2.json"));
    // vcfOps is per-fleet and already lives once on the initial instance.
    mgmtCluster(f.instances[1]).infraStack.push({ id: "vcfOps", instances: 1, role: "mgmt" });
    expect(idsOf(validateFleetInvariants(f))).toContain("VCF-INV-010");
  });
});

describe("VCF-INV-011: per-fleet appliances live on the initial instance only", () => {
  it("fires when a per-fleet appliance is MOVED to a non-initial instance", () => {
    const f = clone(load("multi-instance-2.json"));
    const initial = getInitialInstance(f);
    const other = f.instances.find((i) => i.id !== initial.id);
    // Move (not duplicate) fleetMgr so INV-010 count stays 1 and we isolate INV-011.
    const initStack = mgmtCluster(initial).infraStack;
    const fm = initStack.find((e) => e.id === "fleetMgr");
    initStack.splice(initStack.indexOf(fm), 1);
    mgmtCluster(other).infraStack.push({ ...fm });
    const ids = idsOf(validateFleetInvariants(f));
    expect(ids).toContain("VCF-INV-011");
    expect(ids).not.toContain("VCF-INV-010"); // still exactly one in the fleet
  });
});

describe("VCF-INV-012: every non-initial instance has a Collector", () => {
  it("fires when a non-initial instance has no vcfOpsCollector", () => {
    const f = clone(load("multi-instance-2.json"));
    const initial = getInitialInstance(f);
    const other = f.instances.find((i) => i.id !== initial.id);
    const stack = mgmtCluster(other).infraStack;
    const idx = stack.findIndex((e) => e.id === "vcfOpsCollector");
    stack.splice(idx, 1);
    expect(idsOf(validateFleetInvariants(f))).toContain("VCF-INV-012");
  });
  it("emits a warn when the fleet runs Networks but a non-initial instance lacks the Networks Collector", () => {
    const f = clone(load("multi-instance-2.json"));
    const initial = getInitialInstance(f);
    const other = f.instances.find((i) => i.id !== initial.id);
    const stack = mgmtCluster(other).infraStack;
    stack.splice(stack.findIndex((e) => e.id === "vcfOpsNetCollector"), 1);
    const issues = validateFleetInvariants(f);
    const netWarn = issues.find((i) => i.ruleId === "VCF-INV-012" && i.severity === "warn");
    expect(netWarn, JSON.stringify(issues)).toBeTruthy();
    // The hard collector is still present, so no critical INV-012 here.
    expect(issues.some((i) => i.ruleId === "VCF-INV-012" && i.severity === "critical")).toBe(false);
  });
});

describe("VCF-INV-020: workload NSX Manager never crosses instances", () => {
  it("fires when the same workload NSX key appears on two instances", () => {
    const f = clone(load("multi-instance-2.json"));
    for (const inst of f.instances) {
      inst.domains.push({
        type: "workload", name: "wld-shared",
        clusters: [{ id: `wld-${inst.id}`, infraStack: [{ id: "nsxMgr", role: "wld", key: "shared-wld-nsx", instances: 1 }] }],
      });
    }
    expect(idsOf(validateFleetInvariants(f))).toContain("VCF-INV-020");
  });
});

describe("VCF-INV-021: NSX Global Manager only when instances>=2 AND federation", () => {
  it("fires when a Global Manager exists but federation is disabled", () => {
    const f = clone(load("multi-instance-2.json"));
    expect(f.federationEnabled).toBe(false);
    mgmtCluster(f.instances[0]).infraStack.push({ id: "nsxGlobalMgr", instances: 1, role: "mgmt" });
    expect(idsOf(validateFleetInvariants(f))).toContain("VCF-INV-021");
  });
});

describe("VCF-INV-040: stretched instance shares one mgmt stack", () => {
  it("fires when a stretched instance has a duplicated SDDC Manager", () => {
    const f = clone(load("multi-instance-2.json"));
    f.instances[0].siteIds = ["site-0001", "site-0002"];
    mgmtCluster(f.instances[0]).infraStack.push({ id: "sddcMgr", instances: 1, role: "mgmt" });
    expect(idsOf(validateFleetInvariants(f))).toContain("VCF-INV-040");
  });
});

describe("VCF-INV-051: Federation profiles require >=2 instances", () => {
  it("fires when a single-instance fleet uses a Federation profile", () => {
    const f = clone(load("minimal-simple.json"));
    expect(f.instances.length).toBe(1);
    f.instances[0].deploymentProfile = "haFederation";
    expect(idsOf(validateFleetInvariants(f))).toContain("VCF-INV-051");
  });
});

describe("no false positives — every pristine fixture validates clean", () => {
  it.each(fixtureFiles)("%s emits zero invariant issues", (file) => {
    const issues = validateFleetInvariants(load(file));
    expect(issues, `${file}: ${JSON.stringify(issues, null, 2)}`).toEqual([]);
  });
});
