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

describe("VCF-INV-002: per-instance appliances live on the mgmt domain", () => {
  it("fires when a per-instance appliance sits in a workload domain", () => {
    const f = clone(load("multi-instance-2.json"));
    f.instances[0].domains.push({
      type: "workload", name: "wld-misplaced",
      clusters: [{ id: "wld-x", infraStack: [{ id: "vcfOpsCollector", instances: 1 }] }],
    });
    expect(idsOf(validateFleetInvariants(f))).toContain("VCF-INV-002");
  });
  it("does NOT fire for a dual-role 'wld' appliance in the mgmt domain (VCF-APP-003)", () => {
    const f = clone(load("multi-instance-2.json"));
    mgmtCluster(f.instances[0]).infraStack.push({ id: "vcenter", role: "wld", instances: 1, key: "wld-vc" });
    expect(idsOf(validateFleetInvariants(f))).not.toContain("VCF-INV-002");
  });
});

describe("VCF-INV-030: Identity Broker mode matches fleet size (soft/warn)", () => {
  it("warns when an embedded broker fleet has more than one instance", () => {
    const f = clone(load("multi-instance-2.json")); // embedded + 2 instances
    expect(f.ssoMode).toBe("embedded");
    const inv030 = validateFleetInvariants(f).find((i) => i.ruleId === "VCF-INV-030");
    expect(inv030).toBeTruthy();
    expect(inv030.severity).toBe("warn");
  });
  it("does NOT warn for a single-instance embedded fleet", () => {
    const f = clone(load("minimal-simple.json"));
    expect(f.instances.length).toBe(1);
    expect(idsOf(validateFleetInvariants(f))).not.toContain("VCF-INV-030");
  });
});

describe("VCF-INV-031: <=5 instances per Identity Broker (soft/warn)", () => {
  it("warns when a single-broker fleet exceeds 5 instances", () => {
    const f = clone(load("multi-instance-2.json"));
    f.ssoMode = "fleet-wide"; // one broker
    // Pad to 6 collector-only instances (no per-fleet appliances → no INV-010/011/012).
    for (let n = 3; n <= 6; n++) {
      f.instances.push({
        id: `inst-000${n}`, name: `inst ${n}`, siteIds: ["site-0001"], deploymentProfile: "ha",
        domains: [{ type: "mgmt", name: "mgmt", clusters: [{ id: `clu-000${n}`,
          infraStack: [{ id: "sddcMgr", role: "mgmt", instances: 1 }, { id: "vcfOpsCollector", instances: 1 }] }] }],
      });
    }
    expect(f.instances.length).toBe(6);
    const inv031 = validateFleetInvariants(f).find((i) => i.ruleId === "VCF-INV-031");
    expect(inv031, JSON.stringify(validateFleetInvariants(f))).toBeTruthy();
    expect(inv031.severity).toBe("warn");
  });
  it("does NOT warn for the multi-broker fixture (2 brokers, 3 instances each)", () => {
    const f = load("sso-multi-broker-segmented.json");
    expect(idsOf(validateFleetInvariants(f))).not.toContain("VCF-INV-031");
  });
});

describe("VCF-INV-032: fleet services connect to exactly one existing broker", () => {
  it("fires when a multi-broker fleet has no fleet-services broker designated", () => {
    const f = clone(load("sso-multi-broker-segmented.json"));
    expect(f.ssoBrokers.length).toBeGreaterThan(1);
    f.ssoFleetServicesBrokerId = null;
    const inv032 = validateFleetInvariants(f).find((i) => i.ruleId === "VCF-INV-032");
    expect(inv032).toBeTruthy();
    expect(inv032.severity).toBe("critical");
  });
  it("fires when the fleet-services broker references a non-existent broker", () => {
    const f = clone(load("sso-multi-broker-segmented.json"));
    f.ssoFleetServicesBrokerId = "broker-ghost";
    expect(idsOf(validateFleetInvariants(f))).toContain("VCF-INV-032");
  });
  it("does NOT fire when the multi-broker fleet designates a valid broker", () => {
    const f = load("sso-multi-broker-segmented.json"); // ships ssoFleetServicesBrokerId = broker-east
    expect(idsOf(validateFleetInvariants(f))).not.toContain("VCF-INV-032");
  });
  it("does NOT fire for a single-broker / embedded fleet", () => {
    expect(idsOf(validateFleetInvariants(load("multi-instance-2.json")))).not.toContain("VCF-INV-032");
  });
});

describe("VCF-INV-050: mgmt stack must match the deployment profile", () => {
  it("fires when a conformant fleet is missing a profile-required appliance", () => {
    const f = clone(load("minimal-simple.json")); // 'simple', fully conformant
    const stack = mgmtCluster(f.instances[0]).infraStack;
    stack.splice(stack.findIndex((e) => e.id === "vcenter"), 1);
    const inv050 = validateFleetInvariants(f).find((i) => i.ruleId === "VCF-INV-050");
    expect(inv050).toBeTruthy();
    expect(inv050.severity).toBe("critical");
    expect(inv050.message).toMatch(/vCenter|vcenter/i);
  });
  it("does NOT fire for a conformant fleet", () => {
    expect(idsOf(validateFleetInvariants(load("minimal-simple.json")))).not.toContain("VCF-INV-050");
  });
  it("does NOT flag EXTRA appliances beyond the profile", () => {
    const f = clone(load("minimal-simple.json"));
    mgmtCluster(f.instances[0]).infraStack.push({ id: "srm", instances: 1, role: "mgmt" });
    expect(idsOf(validateFleetInvariants(f))).not.toContain("VCF-INV-050");
  });
  it("uses the fleet's own VCF version (9.0 fleets are not faulted for missing 9.1-only VCFMS)", () => {
    // All v5 fixtures are 9.0; VCFMS is 9.1-only. A conformant 9.0 fleet must
    // not be flagged for lacking vcfmsControl/vcfmsWorker.
    const issues = validateFleetInvariants(load("multi-instance-2.json"));
    expect(issues.filter((i) => i.ruleId === "VCF-INV-050")).toEqual([]);
  });
});

// Two fixtures intentionally stub their mgmt stack to a single SDDC Manager to
// drive minimal-demand sizing scenarios (see scripts/generate-fixtures.mjs:
// make3NodeVsanWarning / makeOverrideRaisesFloor). They are NOT deployable
// designs — a real 'simple' fleet missing vCenter/NSX IS a misconfiguration —
// so INV-050 correctly flags them. They are documented exceptions here.
const KNOWN_INV050_STUBS = new Set(["3-node-vsan-warning.json", "override-raises-floor.json"]);

describe("INV-050 fires only on the known intentional stub fixtures", () => {
  it.each(fixtureFiles)("%s", (file) => {
    const inv050 = validateFleetInvariants(load(file)).filter((i) => i.ruleId === "VCF-INV-050");
    if (KNOWN_INV050_STUBS.has(file)) {
      expect(inv050.length, `${file} should trip INV-050 (intentional stub)`).toBeGreaterThan(0);
    } else {
      expect(inv050, `${file}: unexpected INV-050 ${JSON.stringify(inv050)}`).toEqual([]);
    }
  });
});

describe("no false positives — pristine fixtures emit no UNEXPECTED critical/error issues", () => {
  // Soft advisory warns (e.g. INV-030 on an embedded multi-instance fleet) are
  // legitimate on valid-but-suboptimal designs. The only expected criticals on
  // pristine fixtures are INV-050 on the two intentional sizing stubs above.
  it.each(fixtureFiles)("%s", (file) => {
    let blocking = validateFleetInvariants(load(file))
      .filter((i) => i.severity === "critical" || i.severity === "error");
    if (KNOWN_INV050_STUBS.has(file)) blocking = blocking.filter((i) => i.ruleId !== "VCF-INV-050");
    expect(blocking, `${file}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
  });
});
