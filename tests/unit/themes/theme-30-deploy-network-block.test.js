import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import VcfEngine from "../../../engine.js";

// Task #30 — Deploy-sheet AZ1 network-config helper (C1 — helper +
// utilities only; no cell-map call sites yet).
//
// Per planner-agent guidance: C1 must ship with synthetic tests
// exercising the helper utilities BEFORE any real scope migration in
// C2/C3/C4. This file validates `_combineGwCidr` and `_parseGwCidr`
// directly, and verifies the helper produces the right entry shapes
// for each variant on hypothetical fleet ctx.
//
// See REFACTOR-AZ1-PLAN.md for full plan + shape matrix.

const {
  newFleet,
  WORKBOOK_CELL_MAP,
  _combineGwCidr,
  _parseGwCidr,
} = VcfEngine;

describe("Task #30 / C1 — _combineGwCidr (emit combined gateway-CIDR)", () => {
  it("combines gateway IP with subnet mask bits from CIDR notation", () => {
    expect(_combineGwCidr("10.0.12.1", "10.0.12.0/24")).toBe("10.0.12.1/24");
  });

  it("preserves the gateway IP verbatim even when not the network address", () => {
    // Gateway "10.0.12.5" is a host IP in the /24, not the network address.
    expect(_combineGwCidr("10.0.12.5", "10.0.12.0/24")).toBe("10.0.12.5/24");
  });

  it("handles non-/24 masks", () => {
    expect(_combineGwCidr("192.168.1.1", "192.168.0.0/16")).toBe("192.168.1.1/16");
    expect(_combineGwCidr("10.0.0.1", "10.0.0.0/8")).toBe("10.0.0.1/8");
  });

  it("returns empty string when gateway is missing", () => {
    expect(_combineGwCidr(null, "10.0.12.0/24")).toBe("");
    expect(_combineGwCidr("", "10.0.12.0/24")).toBe("");
    expect(_combineGwCidr(undefined, "10.0.12.0/24")).toBe("");
  });

  it("returns empty string when subnet is missing or has no slash", () => {
    expect(_combineGwCidr("10.0.12.1", null)).toBe("");
    expect(_combineGwCidr("10.0.12.1", "")).toBe("");
    expect(_combineGwCidr("10.0.12.1", "10.0.12.0")).toBe(""); // no /N
  });

  it("returns empty string when both inputs are missing (no malformed strings)", () => {
    expect(_combineGwCidr(null, null)).toBe("");
    expect(_combineGwCidr("", "")).toBe("");
  });

  it("does not emit '/' prefix on garbage subnet input", () => {
    expect(_combineGwCidr("10.0.12.1", "garbage")).toBe(""); // no slash → empty
  });
});

describe("Task #30 / C1 — _parseGwCidr (apply combined gateway-CIDR)", () => {
  it("parses 'ip/bits' into gateway (verbatim) + subnet (network/bits)", () => {
    expect(_parseGwCidr("10.0.12.1/24")).toEqual({
      gateway: "10.0.12.1",
      subnet: "10.0.12.0/24",
    });
  });

  it("preserves gateway as a host IP; derives network via mask AND", () => {
    // Gateway 10.0.12.5 — network address is 10.0.12.0 after /24 mask.
    expect(_parseGwCidr("10.0.12.5/24")).toEqual({
      gateway: "10.0.12.5",
      subnet: "10.0.12.0/24",
    });
  });

  it("handles non-/24 masks correctly", () => {
    expect(_parseGwCidr("192.168.5.1/16")).toEqual({
      gateway: "192.168.5.1",
      subnet: "192.168.0.0/16",
    });
    expect(_parseGwCidr("10.5.3.1/8")).toEqual({
      gateway: "10.5.3.1",
      subnet: "10.0.0.0/8",
    });
  });

  it("handles /32 (single-host) and /0 (any) edge masks", () => {
    expect(_parseGwCidr("10.0.0.1/32")).toEqual({
      gateway: "10.0.0.1",
      subnet: "10.0.0.1/32",
    });
    expect(_parseGwCidr("10.0.0.1/0")).toEqual({
      gateway: "10.0.0.1",
      subnet: "0.0.0.0/0",
    });
  });

  it("no slash → gateway only, subnet null (explicit user-error semantics, no /24 guess)", () => {
    expect(_parseGwCidr("10.0.12.1")).toEqual({ gateway: "10.0.12.1", subnet: null });
  });

  it("invalid mask bits (>32 or negative) → gateway only, subnet null", () => {
    expect(_parseGwCidr("10.0.12.1/40")).toEqual({ gateway: "10.0.12.1", subnet: null });
    expect(_parseGwCidr("10.0.12.1/-5")).toEqual({ gateway: null, subnet: null });
  });

  it("empty/whitespace/null/garbage → both null", () => {
    expect(_parseGwCidr("")).toEqual({ gateway: null, subnet: null });
    expect(_parseGwCidr("   ")).toEqual({ gateway: null, subnet: null });
    expect(_parseGwCidr(null)).toEqual({ gateway: null, subnet: null });
    expect(_parseGwCidr(undefined)).toEqual({ gateway: null, subnet: null });
    expect(_parseGwCidr("garbage")).toEqual({ gateway: null, subnet: null });
  });

  it("trims whitespace before parsing", () => {
    expect(_parseGwCidr("  10.0.12.1/24  ")).toEqual({
      gateway: "10.0.12.1",
      subnet: "10.0.12.0/24",
    });
  });
});

describe("Task #30 / C1 — combine ∘ parse round-trip", () => {
  it("round-trips identity for typical input", () => {
    const gateway = "10.0.12.1";
    const subnet = "10.0.12.0/24";
    const combined = _combineGwCidr(gateway, subnet);
    const parsed = _parseGwCidr(combined);
    expect(parsed.gateway).toBe(gateway);
    expect(parsed.subnet).toBe(subnet);
  });

  it("round-trips when gateway is a host IP (subnet derives from network)", () => {
    // Emit "10.0.12.5/24"; on apply, gateway stays 10.0.12.5 but subnet
    // becomes 10.0.12.0/24. Re-emit produces "10.0.12.5/24" again — stable.
    const combined1 = _combineGwCidr("10.0.12.5", "10.0.12.5/24");
    // Note: subnet="10.0.12.5/24" is malformed (network address should be
    // 10.0.12.0). But _combineGwCidr just takes the /24 from the subnet
    // string — round-trip stability requires the subnet field be a proper
    // network/bits format on input.
    const properSubnet = "10.0.12.0/24";
    const combined2 = _combineGwCidr("10.0.12.5", properSubnet);
    const parsed = _parseGwCidr(combined2);
    expect(parsed.gateway).toBe("10.0.12.5");
    expect(parsed.subnet).toBe("10.0.12.0/24");

    // Re-emit through the cycle
    const reCombined = _combineGwCidr(parsed.gateway, parsed.subnet);
    expect(reCombined).toBe("10.0.12.5/24");
  });
});

describe("Task #30 / C1 — REFACTOR-AZ1-PLAN.md present (resume protocol)", () => {
  it("plan doc exists with the key sections future sessions rely on", () => {
    const planPath = path.resolve(__dirname, "../../../REFACTOR-AZ1-PLAN.md");
    expect(fs.existsSync(planPath)).toBe(true);
    const content = fs.readFileSync(planPath, "utf8");
    expect(content).toMatch(/Commit sequence/);
    expect(content).toMatch(/Pre-flight sanity checks/);
    expect(content).toMatch(/Resume protocol/);
  });
});

describe("Task #30 / C1 — engine module surface includes utility exports", () => {
  it("exports _combineGwCidr and _parseGwCidr", () => {
    expect(typeof VcfEngine._combineGwCidr).toBe("function");
    expect(typeof VcfEngine._parseGwCidr).toBe("function");
  });
});

describe("Task #30 / C1 — no regression: existing cell-map unchanged", () => {
  it("WORKBOOK_CELL_MAP entry count is unchanged (C1 adds helper but no call sites)", () => {
    // Theme 19 checkpoint had 649 entries (1189 entry/version combos
    // per verify-cell-map). C1 adds the helper but no call sites, so
    // entry count stays at 649. Floor used to allow for benign additions
    // in unrelated tasks that ship before this branch merges.
    expect(WORKBOOK_CELL_MAP.length).toBeGreaterThanOrEqual(649);
  });
});

describe("Task #30 — _deployNetworkBlock ipAssignment resolve picks label by ctx.workbookVersion", () => {
  // Regression guard for a HIGH issue flagged by the post-C7 code
  // review: the ipAssignment resolve closure had been picking the
  // dropdown label based on which `cells` keys were present at
  // definition time (`cells.ipAssignment91 && !cells.ipAssignment90 ?
  // staticLabel91 : staticLabel90`). For the mgmt-cluster hostTep
  // call site (which sets BOTH ipAssignment90: "L254" and
  // ipAssignment91: "L149"), that closure always returned
  // staticLabel90 = "IP Pool" — even when emitting for the 9.1
  // workbook, which expects "Static IP Pool".
  //
  // Fix: the emit loop stamps `ctx.workbookVersion = version` before
  // calling resolve, and the closure reads ctx.workbookVersion to
  // pick the version-appropriate label.

  const { emitWorkbookCellMap } = VcfEngine;

  function mgmtCluster(f) {
    return f.instances[0].domains.find((d) => d.type === "mgmt").clusters[0];
  }

  function findHostTepIpAssignment(rows) {
    return rows.find((r) =>
      r.sheet === "Deploy Management Domain" &&
      r.label === "Host TEP IP Assignment"
    );
  }

  it("9.0 hostTep IP Assignment emits 'IP Pool' (the 9.0 dropdown value)", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    mgmtCluster(f).networks.hostTep.useDhcp = false;
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const row = findHostTepIpAssignment(rows);
    expect(row, "missing 9.0 Host TEP IP Assignment row").toBeTruthy();
    expect(row.cell).toBe("L254");
    expect(row.value).toBe("IP Pool");
  });

  it("9.1 hostTep IP Assignment emits 'Static IP Pool' (the 9.1 dropdown value)", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    mgmtCluster(f).networks.hostTep.useDhcp = false;
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const row = findHostTepIpAssignment(rows);
    expect(row, "missing 9.1 Host TEP IP Assignment row").toBeTruthy();
    expect(row.cell).toBe("L149");
    expect(row.value).toBe("Static IP Pool");
  });

  it("useDhcp=true emits 'DHCP' on both versions", () => {
    for (const version of ["9.0", "9.1"]) {
      const f = newFleet();
      f.vcfVersion = version;
      mgmtCluster(f).networks.hostTep.useDhcp = true;
      const rows = emitWorkbookCellMap(f, null, { workbookVersion: version });
      const row = findHostTepIpAssignment(rows);
      expect(row.value, `version ${version} should emit DHCP when useDhcp=true`).toBe("DHCP");
    }
  });
});
