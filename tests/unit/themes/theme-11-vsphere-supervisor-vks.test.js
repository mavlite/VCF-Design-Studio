import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

// Theme 11 — vSphere Supervisor / VKS (9.1 major expansion).
// New per-cluster surface: cluster.supervisorConfig (top-level toggle
// + networking, identity, storage, mgmt-network, NSX project, CIDRs,
// control-plane sizing, per-node identity, and a nested deployment
// sub-object for the Deploy WLD-exclusive fields). Admin password
// rides the new supervisor-admin Camp B vault flow.

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  migrateFleet,
  createClusterSupervisorConfig,
  createSupervisorDeployment,
  WORKBOOK_CELL_MAP,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
  generateWorkbookVault,
} = VcfEngine;

const MGMT_SHEET = "Configure Management Domain";
const WLD_SHEET = "Configure Workload Domain";
const DEPLOY_WLD_SHEET = "Deploy Workload Domain";

function findEntry(label) {
  return WORKBOOK_CELL_MAP.find((e) => e.label === label);
}

function fleetWith91Wld() {
  const f = newFleet();
  f.vcfVersion = "9.1";
  f.version = "vcf-sizer-v9";
  f.instances[0].domains.push(newWorkloadDomain("WLD-01"));
  return f;
}

function wldCluster(f) {
  return f.instances[0].domains.find((d) => d.type === "workload").clusters[0];
}

describe("Theme 11 — factory shape", () => {
  it("createClusterSupervisorConfig documents the full field set with sensible defaults", () => {
    const sc = createClusterSupervisorConfig();
    expect(sc.enabled).toBe(false);
    expect(sc.networkingStack).toBe("VCF Networking with VPC");
    expect(sc.supervisorLocation).toBe("Cluster Deployment");
    expect(sc.haEnabled).toBe("Selected");
    expect(sc.ipAssignmentMode).toBe("Static");
    expect(sc.controlPlaneSize).toBe("Small");
    expect(sc.edgeClusterSize).toBe("Medium");
    expect(sc.supervisorName).toBe("");
    expect(sc.vSphereZoneName).toBe("");
    expect(sc.serviceCidr).toBe("");
    expect(sc.deployment).toEqual(createSupervisorDeployment());
  });

  it("createSupervisorDeployment documents the 6 Deploy WLD extras", () => {
    expect(createSupervisorDeployment()).toEqual({
      useEsxiMgmtVmk: "Unselected",
      controlPlaneIpRange: "",
      subnetMask: "",
      gateway: "",
      vds: "",
      privateTgwCidr: "",
    });
  });

  it("factories produce fresh objects on each call (no shared refs)", () => {
    const a = createClusterSupervisorConfig();
    a.supervisorName = "mutate";
    a.deployment.vds = "mutate";
    const b = createClusterSupervisorConfig();
    expect(b.supervisorName).toBe("");
    expect(b.deployment.vds).toBe("");
  });
});

describe("Theme 11 — newFleet wires supervisorConfig on every cluster", () => {
  it("mgmt cluster's supervisorConfig matches the factory", () => {
    const f = newFleet();
    const c = f.instances[0].domains[0].clusters[0];
    expect(c.supervisorConfig).toEqual(createClusterSupervisorConfig());
  });
  it("workload cluster's supervisorConfig matches the factory", () => {
    const f = fleetWith91Wld();
    expect(wldCluster(f).supervisorConfig).toEqual(createClusterSupervisorConfig());
  });
});

describe("Theme 11 — migrateFleet backfill", () => {
  it("backfills supervisorConfig on a legacy cluster that lacks it", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    delete f.instances[0].domains[0].clusters[0].supervisorConfig;
    const m = migrateFleet(f);
    expect(m.instances[0].domains[0].clusters[0].supervisorConfig).toEqual(createClusterSupervisorConfig());
  });

  it("preserves customized supervisorConfig values across re-migrate (idempotent)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    const c = f.instances[0].domains[0].clusters[0];
    c.supervisorConfig.enabled = true;
    c.supervisorConfig.supervisorName = "sup-01";
    c.supervisorConfig.controlPlaneSize = "Large";
    c.supervisorConfig.serviceCidr = "172.31.0.0/16";
    c.supervisorConfig.deployment.vds = "vds-mgmt";
    c.supervisorConfig.deployment.subnetMask = "255.255.255.0";

    const r1 = migrateFleet(f);
    const r2 = migrateFleet(r1);
    const rc = r2.instances[0].domains[0].clusters[0];
    expect(rc.supervisorConfig.enabled).toBe(true);
    expect(rc.supervisorConfig.supervisorName).toBe("sup-01");
    expect(rc.supervisorConfig.controlPlaneSize).toBe("Large");
    expect(rc.supervisorConfig.serviceCidr).toBe("172.31.0.0/16");
    expect(rc.supervisorConfig.deployment.vds).toBe("vds-mgmt");
    expect(rc.supervisorConfig.deployment.subnetMask).toBe("255.255.255.0");
  });

  it("drops unknown keys at both supervisorConfig + deployment levels", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.instances[0].domains[0].clusters[0].supervisorConfig = {
      enabled: true,
      supervisorName: "sup",
      bogus1: "junk",
      deployment: { vds: "v", bogus2: "junk" },
    };
    const m = migrateFleet(f);
    const sc = m.instances[0].domains[0].clusters[0].supervisorConfig;
    expect(sc).not.toHaveProperty("bogus1");
    expect(sc.deployment).not.toHaveProperty("bogus2");
    expect(sc.enabled).toBe(true);
    expect(sc.supervisorName).toBe("sup");
    expect(sc.deployment.vds).toBe("v");
    // Missing fields fall through to factory defaults.
    expect(sc.networkingStack).toBe("VCF Networking with VPC");
    expect(sc.deployment.useEsxiMgmtVmk).toBe("Unselected");
  });
});

describe("Theme 11 — WORKBOOK_CELL_MAP entries", () => {
  it("ships 32 mgmt-cluster entries on Configure Mgmt (31 stamp + 1 vault, 9.1-only)", () => {
    const entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === MGMT_SHEET && e.scope === "mgmt-cluster" && /^Supervisor /.test(e.label) && /\(Mgmt\)$/.test(e.label)
    );
    expect(entries).toHaveLength(32);
    for (const e of entries) {
      expect(e.workbookVersions).toEqual(["9.1"]);
    }
    // Spot-check a few cells against the workbook.
    expect(findEntry("Supervisor Networking Stack (Mgmt)").cell).toBe("D242");
    expect(findEntry("Supervisor Name (Mgmt)").cell).toBe("D245");
    expect(findEntry("Supervisor Service CIDR (Mgmt)").cell).toBe("D268");
    expect(findEntry("Supervisor Cluster Name (Mgmt)").cell).toBe("D289");
    // Vault entry has passwordKind + emitOnly, no apply.
    const pwd = findEntry("Supervisor Admin Password (Mgmt)");
    expect(pwd.cell).toBe("D283");
    expect(pwd.passwordKind).toBe("supervisor-admin");
    expect(pwd.emitOnly).toBe(true);
  });

  it("ships 32 workload-cluster entries on Configure WLD (31 stamp + 1 vault, 9.1-only)", () => {
    const entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === WLD_SHEET && e.scope === "workload-cluster" && /^Supervisor /.test(e.label) && /\(WLD\)$/.test(e.label)
    );
    expect(entries).toHaveLength(32);
    for (const e of entries) {
      expect(e.workbookVersions).toEqual(["9.1"]);
    }
    expect(findEntry("Supervisor Networking Stack (WLD)").cell).toBe("D188");
    expect(findEntry("Supervisor Name (WLD)").cell).toBe("D191");
    expect(findEntry("Supervisor Service CIDR (WLD)").cell).toBe("D214");
    expect(findEntry("Supervisor Cluster Name (WLD)").cell).toBe("D235");
    // WLD vault entry uses a different cell from Mgmt.
    expect(findEntry("Supervisor Admin Password (WLD)").cell).toBe("D229");
  });

  it("Mgmt vs WLD blocks declare the right edge-cluster enums", () => {
    expect(findEntry("Supervisor Edge Cluster Size (Mgmt)").dataValidation).toEqual(["Small", "Medium", "Large"]);
    expect(findEntry("Supervisor Edge Cluster Size (WLD)").dataValidation).toEqual(["Excluded", "Small", "Medium", "Large"]);
  });

  it("Networking Stack + Supervisor Location enums match the workbook dropdowns", () => {
    expect(findEntry("Supervisor Networking Stack (Mgmt)").dataValidation).toEqual(["VCF Networking with VPC", "vSphere Distributed Switch"]);
    expect(findEntry("Supervisor Location (Mgmt)").dataValidation).toEqual(["vSphere Zone Deployment", "Cluster Deployment"]);
    expect(findEntry("Supervisor IP Assignment Mode (Mgmt)").dataValidation).toEqual(["Static", "DHCP"]);
    expect(findEntry("Supervisor Control Plane Size (Mgmt)").dataValidation).toEqual(["Tiny", "Small", "Medium", "Large", "XLarge"]);
  });

  it("ships 12 Deploy WLD supervisor-deployment extras (workload-cluster scope)", () => {
    const cells = ["D341", "D342", "D343", "D344", "D345", "D346", "D347", "D349", "D350", "D351", "D352", "D353"];
    for (const c of cells) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.sheet === DEPLOY_WLD_SHEET && x.cell === c && /^Supervisor /.test(x.label));
      expect(e, `Deploy WLD ${c}`).toBeTruthy();
      expect(e.workbookVersions).toEqual(["9.1"]);
      expect(e.scope).toBe("workload-cluster");
    }
    // Use ESXi VMK has the right enum.
    expect(findEntry("Supervisor Use ESXi Mgmt VMK").dataValidation).toEqual(["Selected", "Unselected"]);
  });

  it("Deploy WLD Supervisor Name (D341) shares the model field with Configure WLD (D191)", () => {
    const f = fleetWith91Wld();
    wldCluster(f).supervisorConfig.supervisorName = "shared-name";
    const dep = findEntry("Supervisor Name (Deploy WLD)");
    const cfg = findEntry("Supervisor Name (WLD)");
    expect(dep.resolve(f, { instance: f.instances[0], cluster: wldCluster(f) })).toBe("shared-name");
    expect(cfg.resolve(f, { instance: f.instances[0], cluster: wldCluster(f) })).toBe("shared-name");
  });
});

describe("Theme 11 — emit + round-trip", () => {
  it("emits factory defaults at the right cells on a fresh 9.1 fleet", () => {
    const f = fleetWith91Wld();
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (sheet, cell) => rows.find((r) => r.sheet === sheet && r.cell === cell);
    expect(find(MGMT_SHEET, "D242").value).toBe("VCF Networking with VPC");
    expect(find(MGMT_SHEET, "D272").value).toBe("Small");
    expect(find(MGMT_SHEET, "D281").value).toBe("Medium");
    expect(find(WLD_SHEET, "D200").value).toBe("Static");
    expect(find(DEPLOY_WLD_SHEET, "D343").value).toBe("Unselected");
  });

  it("does NOT emit theme-11 entries on a 9.0 fleet (9.1-only gate)", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    f.version = "vcf-sizer-v9";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    expect(rows.find((r) => /^Supervisor /.test(r.label))).toBeUndefined();
  });

  it("9.1 CSV round-trip reconstructs supervisorConfig across mgmt + workload clusters", () => {
    const original = fleetWith91Wld();
    const mgmt = original.instances[0].domains[0].clusters[0];
    mgmt.supervisorConfig.enabled = true;
    mgmt.supervisorConfig.supervisorName = "sup-mgmt";
    mgmt.supervisorConfig.controlPlaneSize = "Large";
    mgmt.supervisorConfig.serviceCidr = "172.31.0.0/16";
    mgmt.supervisorConfig.clusterName = "mgmt-sup";

    const wld = wldCluster(original);
    wld.supervisorConfig.enabled = true;
    wld.supervisorConfig.supervisorName = "sup-wld";
    wld.supervisorConfig.networkingStack = "vSphere Distributed Switch";
    wld.supervisorConfig.edgeClusterSize = "Excluded";
    wld.supervisorConfig.deployment.vds = "vds-wld";
    wld.supervisorConfig.deployment.subnetMask = "255.255.255.0";

    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.1" });

    const reMgmt = rebuilt.instances[0].domains[0].clusters[0];
    expect(reMgmt.supervisorConfig.supervisorName).toBe("sup-mgmt");
    expect(reMgmt.supervisorConfig.controlPlaneSize).toBe("Large");
    expect(reMgmt.supervisorConfig.serviceCidr).toBe("172.31.0.0/16");
    expect(reMgmt.supervisorConfig.clusterName).toBe("mgmt-sup");

    const reWld = wldCluster(rebuilt);
    expect(reWld.supervisorConfig.supervisorName).toBe("sup-wld");
    expect(reWld.supervisorConfig.networkingStack).toBe("vSphere Distributed Switch");
    expect(reWld.supervisorConfig.edgeClusterSize).toBe("Excluded");
    expect(reWld.supervisorConfig.deployment.vds).toBe("vds-wld");
    expect(reWld.supervisorConfig.deployment.subnetMask).toBe("255.255.255.0");
    // The enabled toggle is model-only — not stamped to the workbook
    // (there's no top-level enable cell in the supervisor block, only
    // sub-feature toggles like HA + Use ESXi VMK). Round-trip leaves it
    // at the post-migration factory default.
    expect(typeof reWld.supervisorConfig.enabled).toBe("boolean");
  });

  it("apply normalizers reject out-of-enum values (control plane size, networking stack)", () => {
    const cpSize = findEntry("Supervisor Control Plane Size (Mgmt)");
    const stack = findEntry("Supervisor Networking Stack (Mgmt)");
    const f = newFleet();
    const ctx = { instance: f.instances[0], cluster: f.instances[0].domains[0].clusters[0] };
    cpSize.apply(f, ctx, "bogus");
    expect(ctx.cluster.supervisorConfig.controlPlaneSize).toBe("Small");
    cpSize.apply(f, ctx, "XLarge");
    expect(ctx.cluster.supervisorConfig.controlPlaneSize).toBe("XLarge");
    stack.apply(f, ctx, "Bogus Stack");
    expect(ctx.cluster.supervisorConfig.networkingStack).toBe("VCF Networking with VPC");
  });

  it("apply normalizers reject out-of-enum: Supervisor Location (Mgmt)", () => {
    const e = findEntry("Supervisor Location (Mgmt)");
    const f = newFleet();
    const ctx = { instance: f.instances[0], cluster: f.instances[0].domains[0].clusters[0] };
    e.apply(f, ctx, "bogus");
    expect(ctx.cluster.supervisorConfig.supervisorLocation).toBe("Cluster Deployment");
    e.apply(f, ctx, "vSphere Zone Deployment");
    expect(ctx.cluster.supervisorConfig.supervisorLocation).toBe("vSphere Zone Deployment");
  });

  it("apply normalizers reject out-of-enum: Supervisor HA Enabled (Mgmt)", () => {
    const e = findEntry("Supervisor HA Enabled (Mgmt)");
    const f = newFleet();
    const ctx = { instance: f.instances[0], cluster: f.instances[0].domains[0].clusters[0] };
    e.apply(f, ctx, "garbage");
    expect(ctx.cluster.supervisorConfig.haEnabled).toBe("Selected");
    e.apply(f, ctx, "Unselected");
    expect(ctx.cluster.supervisorConfig.haEnabled).toBe("Unselected");
  });

  it("apply normalizers reject out-of-enum: Supervisor IP Assignment Mode (Mgmt)", () => {
    const e = findEntry("Supervisor IP Assignment Mode (Mgmt)");
    const f = newFleet();
    const ctx = { instance: f.instances[0], cluster: f.instances[0].domains[0].clusters[0] };
    e.apply(f, ctx, "magic");
    expect(ctx.cluster.supervisorConfig.ipAssignmentMode).toBe("Static");
    e.apply(f, ctx, "DHCP");
    expect(ctx.cluster.supervisorConfig.ipAssignmentMode).toBe("DHCP");
  });

  it("apply normalizers reject out-of-enum: Edge Cluster Size has different enums for mgmt vs wld", () => {
    const mgmt = findEntry("Supervisor Edge Cluster Size (Mgmt)");
    const wld = findEntry("Supervisor Edge Cluster Size (WLD)");
    const f = fleetWith91Wld();
    const mgmtCtx = { instance: f.instances[0], cluster: f.instances[0].domains[0].clusters[0] };
    const wldCtx = { instance: f.instances[0], cluster: wldCluster(f) };
    // "Excluded" is WLD-only — mgmt should coerce to factory Medium.
    mgmt.apply(f, mgmtCtx, "Excluded");
    expect(mgmtCtx.cluster.supervisorConfig.edgeClusterSize).toBe("Medium");
    wld.apply(f, wldCtx, "Excluded");
    expect(wldCtx.cluster.supervisorConfig.edgeClusterSize).toBe("Excluded");
    // Bogus value coerces on both.
    mgmt.apply(f, mgmtCtx, "garbage");
    expect(mgmtCtx.cluster.supervisorConfig.edgeClusterSize).toBe("Medium");
    wld.apply(f, wldCtx, "garbage");
    expect(wldCtx.cluster.supervisorConfig.edgeClusterSize).toBe("Medium");
  });

  it("apply normalizers reject out-of-enum: Supervisor Use ESXi Mgmt VMK (Deploy WLD)", () => {
    const e = findEntry("Supervisor Use ESXi Mgmt VMK");
    const f = fleetWith91Wld();
    const ctx = { instance: f.instances[0], cluster: wldCluster(f) };
    e.apply(f, ctx, "bogus");
    expect(ctx.cluster.supervisorConfig.deployment.useEsxiMgmtVmk).toBe("Unselected");
    e.apply(f, ctx, "Selected");
    expect(ctx.cluster.supervisorConfig.deployment.useEsxiMgmtVmk).toBe("Selected");
  });
});

describe("Theme 11 — supervisor-admin vault flow", () => {
  it("supervisor-admin appears in Camp B vault output on a 9.1 fleet", () => {
    const f = fleetWith91Wld();
    const { vault } = generateWorkbookVault(f, { scope: "camp-b", workbookVersion: "9.1" });
    const supervisorCreds = vault.credentials.filter((c) => c.credentialType === "supervisor-admin");
    // Two entries: one per cluster (mgmt + workload).
    expect(supervisorCreds.length).toBeGreaterThanOrEqual(2);
  });
});
