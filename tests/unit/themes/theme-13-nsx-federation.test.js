import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

// Theme 13 — NSX Federation GM cluster + RTEP + cross-instance Tier-1.
// Extends theme 9's per-node block with cluster-level identifiers
// (clusterId / apiThumbprint), federation group name, GM VIP + cert,
// RTEP overlay + IP pool, Local Manager registration metadata, and
// cross-instance Tier-1 + segment names.

const {
  newFleet,
  migrateFleet,
  createFleetFederationConfig,
  createFederationGlobalManagerExtras,
  createFederationLocalManager,
  createFederationTier1,
  WORKBOOK_CELL_MAP,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
} = VcfEngine;

const MGMT_SHEET = "Configure Management Domain";

function findEntry(label) {
  return WORKBOOK_CELL_MAP.find((e) => e.label === label);
}

describe("Theme 13 — factory shape", () => {
  it("createFederationGlobalManagerExtras documents cluster + RTEP fields", () => {
    expect(createFederationGlobalManagerExtras()).toEqual({
      clusterId: "",
      apiThumbprint: "",
      username: "admin",
      federationName: "",
      vipAddress: "",
      certificateId: "",
      rtep: {
        edgeSwitchName: "nsxDefaultHostSwitch",
        vlan: "",
        pool: { name: "", rangeStart: "", rangeEnd: "", cidr: "", gatewayIp: "" },
      },
    });
  });

  it("createFederationLocalManager documents LM registration metadata", () => {
    expect(createFederationLocalManager()).toEqual({
      name: "",
      lmThumbprint: "",
      gmThumbprint: "",
      usernameGm: "",
      usernameLm: "",
      locationName: "",
    });
  });

  it("createFederationTier1 documents cross-instance T1 fields", () => {
    expect(createFederationTier1()).toEqual({
      name: "",
      linkedT0: "",
      crossInstanceSegment: "",
    });
  });

  it("createFleetFederationConfig folds theme 13 fields under globalManager + adds localManager + tier1", () => {
    const cfg = createFleetFederationConfig();
    // Theme 9 surface still intact.
    expect(cfg.globalManager.nodes).toHaveLength(3);
    expect(cfg.globalManager.nodes[0].vmName).toBe("");
    // Theme 13 globalManager extras spread in.
    expect(cfg.globalManager.clusterId).toBe("");
    expect(cfg.globalManager.apiThumbprint).toBe("");
    expect(cfg.globalManager.username).toBe("admin");
    expect(cfg.globalManager.rtep.edgeSwitchName).toBe("nsxDefaultHostSwitch");
    expect(cfg.globalManager.rtep.pool).toEqual({ name: "", rangeStart: "", rangeEnd: "", cidr: "", gatewayIp: "" });
    // New sibling blocks.
    expect(cfg.localManager).toEqual(createFederationLocalManager());
    expect(cfg.tier1).toEqual(createFederationTier1());
  });

  it("factory does not share references across calls", () => {
    const a = createFleetFederationConfig();
    a.globalManager.clusterId = "mutate";
    a.tier1.name = "mutate";
    a.localManager.name = "mutate";
    a.globalManager.rtep.pool.name = "mutate";
    const b = createFleetFederationConfig();
    expect(b.globalManager.clusterId).toBe("");
    expect(b.tier1.name).toBe("");
    expect(b.localManager.name).toBe("");
    expect(b.globalManager.rtep.pool.name).toBe("");
  });
});

describe("Theme 13 — newFleet wires the extended federationConfig", () => {
  it("ships fleet.federationConfig with theme 13 fields present", () => {
    const f = newFleet();
    expect(f.federationConfig).toEqual(createFleetFederationConfig());
    expect(f.federationConfig.globalManager.clusterId).toBe("");
    expect(f.federationConfig.localManager.name).toBe("");
    expect(f.federationConfig.tier1.crossInstanceSegment).toBe("");
  });
});

describe("Theme 13 — migrateFleet backfill", () => {
  it("backfills theme 13 fields when missing on a legacy theme-9-only fleet", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.federationConfig = {
      globalManager: {
        nodes: [
          { vmName: "gm-a", deploySize: "Large", fqdn: "gm-a.lab", mgmtIp: "10.0.0.11", searchList: "lab.local" },
          { vmName: "gm-b", deploySize: "Large", fqdn: "gm-b.lab", mgmtIp: "10.0.0.12", searchList: "lab.local" },
          { vmName: "gm-c", deploySize: "Large", fqdn: "gm-c.lab", mgmtIp: "10.0.0.13", searchList: "lab.local" },
        ],
      },
    };
    const migrated = migrateFleet(f);
    // Theme 9 fields preserved.
    expect(migrated.federationConfig.globalManager.nodes[0].vmName).toBe("gm-a");
    expect(migrated.federationConfig.globalManager.nodes[1].deploySize).toBe("Large");
    // Theme 13 fields backfilled from factory.
    expect(migrated.federationConfig.globalManager.clusterId).toBe("");
    expect(migrated.federationConfig.globalManager.username).toBe("admin");
    expect(migrated.federationConfig.globalManager.rtep.edgeSwitchName).toBe("nsxDefaultHostSwitch");
    expect(migrated.federationConfig.globalManager.rtep.pool.name).toBe("");
    expect(migrated.federationConfig.localManager).toEqual(createFederationLocalManager());
    expect(migrated.federationConfig.tier1).toEqual(createFederationTier1());
  });

  it("preserves user-customized theme 13 fields across re-migrate (idempotent)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.federationConfig.globalManager.clusterId = "abc-123";
    f.federationConfig.globalManager.apiThumbprint = "deadbeef";
    f.federationConfig.globalManager.username = "fed-admin";
    f.federationConfig.globalManager.rtep.vlan = "3001";
    f.federationConfig.globalManager.rtep.pool.cidr = "10.20.30.0/24";
    f.federationConfig.localManager.locationName = "DC-A";
    f.federationConfig.tier1.name = "xinst-t1";
    f.federationConfig.tier1.linkedT0 = "mgmt-t0";

    const round1 = migrateFleet(f);
    const round2 = migrateFleet(round1);
    expect(round2.federationConfig.globalManager.clusterId).toBe("abc-123");
    expect(round2.federationConfig.globalManager.apiThumbprint).toBe("deadbeef");
    expect(round2.federationConfig.globalManager.username).toBe("fed-admin");
    expect(round2.federationConfig.globalManager.rtep.vlan).toBe("3001");
    expect(round2.federationConfig.globalManager.rtep.pool.cidr).toBe("10.20.30.0/24");
    expect(round2.federationConfig.localManager.locationName).toBe("DC-A");
    expect(round2.federationConfig.tier1.name).toBe("xinst-t1");
    expect(round2.federationConfig.tier1.linkedT0).toBe("mgmt-t0");
  });

  it("drops unknown keys at every theme 13 sub-object level (whitelist-merge)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.federationConfig = {
      globalManager: {
        nodes: [{ vmName: "g1" }, {}, {}],
        clusterId: "id",
        bogus: "junk",
        rtep: { vlan: "10", bogus2: "junk", pool: { cidr: "1.2.3.0/24", bogus3: "junk" } },
      },
      localManager: { name: "lm", bogus4: "junk" },
      tier1: { name: "t1", bogus5: "junk" },
    };
    const m = migrateFleet(f).federationConfig;
    expect(m.globalManager).not.toHaveProperty("bogus");
    expect(m.globalManager.rtep).not.toHaveProperty("bogus2");
    expect(m.globalManager.rtep.pool).not.toHaveProperty("bogus3");
    expect(m.localManager).not.toHaveProperty("bogus4");
    expect(m.tier1).not.toHaveProperty("bogus5");
    expect(m.globalManager.clusterId).toBe("id");
    expect(m.globalManager.rtep.vlan).toBe("10");
    expect(m.globalManager.rtep.pool.cidr).toBe("1.2.3.0/24");
    expect(m.localManager.name).toBe("lm");
    expect(m.tier1.name).toBe("t1");
  });

  it("handles missing rtep / pool sub-objects defensively", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.federationConfig.globalManager.rtep = undefined;
    const m = migrateFleet(f).federationConfig;
    expect(m.globalManager.rtep).toEqual({
      edgeSwitchName: "nsxDefaultHostSwitch",
      vlan: "",
      pool: { name: "", rangeStart: "", rangeEnd: "", cidr: "", gatewayIp: "" },
    });
  });
});

describe("Theme 13 — WORKBOOK_CELL_MAP entries", () => {
  it("ships the cluster-level identifier entries (9.1-only)", () => {
    for (const [label, cell] of [
      ["NSX GM Cluster ID", "D524"],
      ["NSX GM Cluster API Thumbprint", "D525"],
      ["NSX GM Federation Name", "D540"],
      ["NSX GM VIP Address", "D546"],
      ["NSX GM Certificate ID", "D552"],
    ]) {
      const e = findEntry(label);
      expect(e, label).toBeTruthy();
      expect(e.sheet).toBe(MGMT_SHEET);
      expect(e.cell).toBe(cell);
      expect(e.workbookVersions).toEqual(["9.1"]);
      expect(e.scope).toBe("instance");
    }
  });

  it("ships per-node username entries pointing at the same cluster-wide field (D529 + D535)", () => {
    const n2 = findEntry("NSX GM Username (Node 2)");
    const n3 = findEntry("NSX GM Username (Node 3)");
    expect(n2.cell).toBe("D529");
    expect(n3.cell).toBe("D535");
    expect(n2.workbookVersions).toEqual(["9.1"]);
    expect(n3.workbookVersions).toEqual(["9.1"]);
    // Both resolve from globalManager.username.
    const f = newFleet();
    f.federationConfig.globalManager.username = "shared-admin";
    expect(n2.resolve(f, {})).toBe("shared-admin");
    expect(n3.resolve(f, {})).toBe("shared-admin");
  });

  it("ships the RTEP IP pool block (5 cells) on 9.1", () => {
    for (const [label, cell] of [
      ["NSX GM RTEP Pool Name", "D562"],
      ["NSX GM RTEP Pool IP Range Start", "D563"],
      ["NSX GM RTEP Pool IP Range End", "D564"],
      ["NSX GM RTEP Pool CIDR", "D565"],
      ["NSX GM RTEP Pool Gateway IP", "D566"],
    ]) {
      const e = findEntry(label);
      expect(e, label).toBeTruthy();
      expect(e.cell).toBe(cell);
      expect(e.workbookVersions).toEqual(["9.1"]);
    }
  });

  it("ships the RTEP overlay config (Edge Switch + VLAN) on 9.1", () => {
    expect(findEntry("NSX GM RTEP Edge Switch Name").cell).toBe("D588");
    expect(findEntry("NSX GM RTEP VLAN").cell).toBe("D589");
  });

  it("ships the Local Manager registration block on 9.1", () => {
    for (const [label, cell] of [
      ["NSX LM Name", "D569"],
      ["NSX LM Thumbprint (LM->GM)", "D572"],
      ["NSX LM GM Username", "D576"],
      ["NSX LM Thumbprint (GM->LM)", "D581"],
      ["NSX LM Location Name", "D583"],
      ["NSX LM Username", "D585"],
    ]) {
      const e = findEntry(label);
      expect(e, label).toBeTruthy();
      expect(e.cell).toBe(cell);
      expect(e.workbookVersions).toEqual(["9.1"]);
    }
  });

  it("ships the cross-instance Tier-1 + segment entries (dual-version)", () => {
    const t1 = findEntry("NSX Tier-1 Gateway Name");
    expect(t1.cell).toBe("D522");
    expect(t1.cellByVersion).toEqual({ "9.1": "D593" });
    expect(t1.workbookVersions).toEqual(["9.0", "9.1"]);

    const t0 = findEntry("NSX Linked Tier-0 Gateway");
    expect(t0.cell).toBe("D523");
    expect(t0.cellByVersion).toEqual({ "9.1": "D594" });
    expect(t0.workbookVersions).toEqual(["9.0", "9.1"]);

    const seg = findEntry("NSX Cross-Instance Segment Name");
    expect(seg.cell).toBe("D528");
    expect(seg.cellByVersion).toEqual({ "9.1": "D599" });
    expect(seg.workbookVersions).toEqual(["9.0", "9.1"]);
  });

  it("RTEP Edge Switch defaults to 'nsxDefaultHostSwitch' on a fresh fleet", () => {
    const f = newFleet();
    const e = findEntry("NSX GM RTEP Edge Switch Name");
    expect(e.resolve(f, {})).toBe("nsxDefaultHostSwitch");
  });

  it("all theme-13 entries are scope:instance with resolve + apply (no vault, no emit-only)", () => {
    const labels = new Set([
      "NSX GM Cluster ID", "NSX GM Cluster API Thumbprint", "NSX GM Username (Node 2)",
      "NSX GM Username (Node 3)", "NSX GM Federation Name", "NSX GM VIP Address",
      "NSX GM Certificate ID", "NSX GM RTEP Pool Name", "NSX GM RTEP Pool IP Range Start",
      "NSX GM RTEP Pool IP Range End", "NSX GM RTEP Pool CIDR", "NSX GM RTEP Pool Gateway IP",
      "NSX GM RTEP Edge Switch Name", "NSX GM RTEP VLAN",
      "NSX LM Name", "NSX LM Thumbprint (LM->GM)", "NSX LM GM Username",
      "NSX LM Thumbprint (GM->LM)", "NSX LM Location Name", "NSX LM Username",
      "NSX Tier-1 Gateway Name", "NSX Linked Tier-0 Gateway", "NSX Cross-Instance Segment Name",
    ]);
    const entries = WORKBOOK_CELL_MAP.filter((e) => labels.has(e.label));
    expect(entries).toHaveLength(23);
    for (const e of entries) {
      expect(e.scope, e.label).toBe("instance");
      expect(typeof e.resolve, e.label).toBe("function");
      expect(typeof e.apply, e.label).toBe("function");
      expect(e.emitOnly, e.label).toBeFalsy();
      expect(e.passwordKind, e.label).toBeFalsy();
    }
  });
});

describe("Theme 13 — emit + round-trip", () => {
  it("emits empty defaults for a fresh fleet on 9.1", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (cell) => rows.find((r) => r.sheet === MGMT_SHEET && r.cell === cell);
    expect(find("D524").value).toBe("");
    expect(find("D588").value).toBe("nsxDefaultHostSwitch");
    expect(find("D593").value).toBe("");                   // dual-version t1 name @ 9.1 address
  });

  it("does NOT emit 9.1-only entries on a 9.0 fleet (version gate)", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    expect(rows.find((r) => r.label === "NSX GM Cluster ID")).toBeUndefined();
    expect(rows.find((r) => r.label === "NSX GM RTEP VLAN")).toBeUndefined();
    // Dual-version entries DO emit on 9.0 (at the 9.0 cells).
    const t1 = rows.find((r) => r.label === "NSX Tier-1 Gateway Name");
    expect(t1).toBeTruthy();
    expect(t1.cell).toBe("D522");
  });

  it("CSV round-trip on 9.1 reconstructs cluster + RTEP + LM + tier1 values", () => {
    const original = newFleet();
    original.vcfVersion = "9.1";
    const gm = original.federationConfig.globalManager;
    gm.clusterId = "11111111-2222-3333-4444-555555555555";
    gm.apiThumbprint = "AA:BB:CC:DD:EE";
    gm.username = "gm-admin";
    gm.federationName = "FedGroup-1";
    gm.vipAddress = "10.0.0.20";
    gm.certificateId = "cert-99";
    gm.rtep.vlan = "3001";
    gm.rtep.pool.name = "rtep-pool-a";
    gm.rtep.pool.rangeStart = "10.20.30.10";
    gm.rtep.pool.rangeEnd = "10.20.30.50";
    gm.rtep.pool.cidr = "10.20.30.0/24";
    gm.rtep.pool.gatewayIp = "10.20.30.1";
    original.federationConfig.localManager.name = "LM-DC-A";
    original.federationConfig.localManager.locationName = "DC-A";
    original.federationConfig.localManager.lmThumbprint = "LM:THUMB";
    original.federationConfig.localManager.gmThumbprint = "GM:THUMB";
    original.federationConfig.localManager.usernameGm = "u-gm";
    original.federationConfig.localManager.usernameLm = "u-lm";
    original.federationConfig.tier1.name = "xinst-t1";
    original.federationConfig.tier1.linkedT0 = "mgmt-t0";
    original.federationConfig.tier1.crossInstanceSegment = "xinst-seg";

    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.1" });

    expect(rebuilt.federationConfig.globalManager.clusterId).toBe("11111111-2222-3333-4444-555555555555");
    expect(rebuilt.federationConfig.globalManager.apiThumbprint).toBe("AA:BB:CC:DD:EE");
    expect(rebuilt.federationConfig.globalManager.username).toBe("gm-admin");
    expect(rebuilt.federationConfig.globalManager.federationName).toBe("FedGroup-1");
    expect(rebuilt.federationConfig.globalManager.vipAddress).toBe("10.0.0.20");
    expect(rebuilt.federationConfig.globalManager.certificateId).toBe("cert-99");
    expect(rebuilt.federationConfig.globalManager.rtep.vlan).toBe("3001");
    expect(rebuilt.federationConfig.globalManager.rtep.pool).toEqual({
      name: "rtep-pool-a", rangeStart: "10.20.30.10", rangeEnd: "10.20.30.50",
      cidr: "10.20.30.0/24", gatewayIp: "10.20.30.1",
    });
    expect(rebuilt.federationConfig.localManager.name).toBe("LM-DC-A");
    expect(rebuilt.federationConfig.localManager.locationName).toBe("DC-A");
    expect(rebuilt.federationConfig.localManager.lmThumbprint).toBe("LM:THUMB");
    expect(rebuilt.federationConfig.localManager.gmThumbprint).toBe("GM:THUMB");
    expect(rebuilt.federationConfig.tier1.name).toBe("xinst-t1");
    expect(rebuilt.federationConfig.tier1.linkedT0).toBe("mgmt-t0");
    expect(rebuilt.federationConfig.tier1.crossInstanceSegment).toBe("xinst-seg");
  });

  it("9.0 round-trip preserves only the cross-instance Tier-1 + segment fields", () => {
    const original = newFleet();
    original.vcfVersion = "9.0";
    original.federationConfig.tier1.name = "xinst-t1-90";
    original.federationConfig.tier1.linkedT0 = "t0-90";
    original.federationConfig.tier1.crossInstanceSegment = "seg-90";

    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.0" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.0" });
    expect(rebuilt.federationConfig.tier1.name).toBe("xinst-t1-90");
    expect(rebuilt.federationConfig.tier1.linkedT0).toBe("t0-90");
    expect(rebuilt.federationConfig.tier1.crossInstanceSegment).toBe("seg-90");
  });

  it("stamps the cluster-wide username to BOTH Node 2 (D529) and Node 3 (D535)", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    f.federationConfig.globalManager.username = "fed-root";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    expect(rows.find((r) => r.cell === "D529" && r.sheet === MGMT_SHEET).value).toBe("fed-root");
    expect(rows.find((r) => r.cell === "D535" && r.sheet === MGMT_SHEET).value).toBe("fed-root");
  });
});
