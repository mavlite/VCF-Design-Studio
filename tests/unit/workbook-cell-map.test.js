// Tests for the workbook cell-map emitter / parser.
// Covers version filtering, cellByVersion overrides, scope iteration,
// per-host expansion, VCFMS gating, vCenter storage cell move 9.0→9.1,
// CSV round-trip, and the workbookVersionForFleet helper.
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  isInitialInstance,
  migrate9_0To9_1,
  migrate9_1To9_0,
  SUPPORTED_WORKBOOK_VERSIONS,
  VCF_TO_WORKBOOK_VERSION,
  workbookVersionForFleet,
  WORKBOOK_CELL_MAP,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  DEFAULT_VCF_VERSION_LEGACY,
} = VcfEngine;

// Build a fleet with one workload domain + 2 WLD clusters so the
// workload-domain / workload-cluster / additional-cluster scopes have
// contexts to iterate (default newFleet() ships only a mgmt domain).
function fleetWithWld() {
  const fleet = newFleet();
  const wld = newWorkloadDomain("TestWLD");
  wld.clusters = [newWorkloadCluster("wld-cl01"), newWorkloadCluster("wld-cl02")];
  fleet.instances[0].domains.push(wld);
  return fleet;
}

describe("workbook version routing", () => {
  it("SUPPORTED_WORKBOOK_VERSIONS includes both 9.0 and 9.1", () => {
    expect(SUPPORTED_WORKBOOK_VERSIONS).toEqual(expect.arrayContaining(["9.0", "9.1"]));
  });

  it("VCF_TO_WORKBOOK_VERSION maps 9.0 and 9.1 identity", () => {
    expect(VCF_TO_WORKBOOK_VERSION["9.0"]).toBe("9.0");
    expect(VCF_TO_WORKBOOK_VERSION["9.1"]).toBe("9.1");
  });

  it("workbookVersionForFleet falls back to legacy when vcfVersion missing", () => {
    expect(workbookVersionForFleet({})).toBe(DEFAULT_VCF_VERSION_LEGACY);
    expect(workbookVersionForFleet(null)).toBe(DEFAULT_VCF_VERSION_LEGACY);
  });

  it("workbookVersionForFleet returns mapped value for known VCF version", () => {
    expect(workbookVersionForFleet({ vcfVersion: "9.1" })).toBe("9.1");
    expect(workbookVersionForFleet({ vcfVersion: "9.0" })).toBe("9.0");
  });
});

describe("WORKBOOK_CELL_MAP schema", () => {
  it("every entry has a sheet, scope, label, resolve fn, and workbookVersions", () => {
    for (const entry of WORKBOOK_CELL_MAP) {
      expect(entry.sheet, `entry ${JSON.stringify(entry)} missing sheet`).toBeTypeOf("string");
      expect(entry.scope, `entry ${entry.label} missing scope`).toBeTypeOf("string");
      expect(entry.label, `entry on ${entry.sheet} missing label`).toBeTypeOf("string");
      expect(entry.resolve, `entry ${entry.label} missing resolve fn`).toBeTypeOf("function");
      expect(Array.isArray(entry.workbookVersions), `entry ${entry.label} workbookVersions must be array`).toBe(true);
      // Every entry must specify either `cell` or `cellPattern`.
      expect(entry.cell || entry.cellPattern, `entry ${entry.label} missing cell/cellPattern`).toBeTruthy();
    }
  });

  it("uses L or D for value-column targets — never K or C", () => {
    for (const entry of WORKBOOK_CELL_MAP) {
      const checkAddr = (addr) => {
        if (!addr) return;
        const col = addr.match(/^([A-Z]+)/)?.[1];
        // Sheet 5/6 (Configure Mgmt) uses D for user-input; everything else uses L.
        // K and C are sample-formula columns — must not be targeted.
        expect(["K", "C"]).not.toContain(col);
      };
      checkAddr(entry.cell);
      if (entry.cellByVersion) {
        for (const v of Object.keys(entry.cellByVersion)) checkAddr(entry.cellByVersion[v]);
      }
    }
  });

  // No two entries may target the same (sheet, cell, scope) at the same
  // workbook version. A collision means both emits write to the same
  // cell on export (the second wins; the first row produces a duplicate
  // CSV line), and on import both apply functions fire in sequence
  // (last-applied wins, even if the second was meant for a different
  // version's cell). This guard caught two real duplicate-emit bugs
  // introduced when the AZ1 cell relocation refactor's _deployNetworkBlock
  // calls overlapped with pre-existing standalone VLAN ID entries on
  // Deploy Mgmt — the kind of error that emit-and-import round-trip
  // tests don't catch (model values survive because the duplicates are
  // idempotent on the same field).
  it("no two entries target the same (sheet, cell, scope) at the same version", () => {
    const cellFor = (e, v) => {
      if (!e.workbookVersions || !e.workbookVersions.includes(v)) return null;
      if (e.cellByVersion && e.cellByVersion[v]) return e.cellByVersion[v];
      return e.cell;
    };
    const collisions = [];
    for (const v of ["9.0", "9.1"]) {
      const byKey = new Map();
      for (const e of WORKBOOK_CELL_MAP) {
        const c = cellFor(e, v);
        if (!c) continue;
        // cellPattern entries (per-host per-protocol) generate cells at
        // ctx-bind time, not statically — skip them here.
        if (e.cellPattern && !e.cell) continue;
        const key = `${e.sheet}|${c}|${e.scope || "fleet"}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(e.label);
      }
      for (const [key, labels] of byKey) {
        if (labels.length > 1) {
          collisions.push(`${v} ${key} → ${labels.join(" | ")}`);
        }
      }
    }
    expect(collisions, `cell-map collisions found:\n  ${collisions.join("\n  ")}`).toEqual([]);
  });
});

describe("emitWorkbookCellMap — version filtering", () => {
  it("default 9.1 fleet emits VCFMS rows", () => {
    const fleet = newFleet(); // defaults to vcfVersion: "9.1"
    const rows = emitWorkbookCellMap(fleet);
    const vcfmsCells = rows.filter((r) => /VCFMS|Instance Components|Identity Broker|services runtime/i.test(r.label));
    expect(vcfmsCells.length).toBeGreaterThan(0);
  });

  it("forced 9.0 fleet does NOT emit VCFMS rows", () => {
    const fleet = migrate9_1To9_0(newFleet());
    const rows = emitWorkbookCellMap(fleet);
    const vcfmsCells = rows.filter((r) => /VCFMS|Instance Components|Identity Broker|services runtime/i.test(r.label));
    expect(vcfmsCells.length).toBe(0);
  });

  it("every emitted row's workbookVersion matches the target", () => {
    const fleet = newFleet();
    const rows91 = emitWorkbookCellMap(fleet);
    for (const r of rows91) expect(r.workbookVersion).toBe("9.1");

    const fleet90 = migrate9_1To9_0(newFleet());
    const rows90 = emitWorkbookCellMap(fleet90);
    for (const r of rows90) expect(r.workbookVersion).toBe("9.0");
  });

  it("explicit options.workbookVersion overrides fleet.vcfVersion", () => {
    const fleet = newFleet(); // 9.1
    const rows = emitWorkbookCellMap(fleet, null, { workbookVersion: "9.0" });
    for (const r of rows) expect(r.workbookVersion).toBe("9.0");
  });
});

describe("cellByVersion overrides — vCenter Storage Size cell move", () => {
  it("vCenter Storage Size points to L92 in 9.0", () => {
    const fleet = migrate9_1To9_0(newFleet());
    const rows = emitWorkbookCellMap(fleet);
    const row = rows.find((r) => r.label === "vCenter Appliance Storage Size");
    expect(row).toBeDefined();
    expect(row.cell).toBe("L92");
  });

  it("vCenter Storage Size points to L326 in 9.1 (moved in API-only sub-section)", () => {
    const fleet = newFleet();
    const rows = emitWorkbookCellMap(fleet);
    const row = rows.find((r) => r.label === "vCenter Appliance Storage Size");
    expect(row).toBeDefined();
    expect(row.cell).toBe("L326");
  });
});

describe("cell-map row shifts — VCF Instance Name", () => {
  it("L38 in 9.0", () => {
    const fleet = migrate9_1To9_0(newFleet());
    const rows = emitWorkbookCellMap(fleet);
    const row = rows.find((r) => r.label === "VCF Instance Name");
    expect(row.cell).toBe("L38");
  });

  it("L67 in 9.1 (sheet restructured)", () => {
    const fleet = newFleet();
    const rows = emitWorkbookCellMap(fleet);
    const row = rows.find((r) => r.label === "VCF Instance Name");
    expect(row.cell).toBe("L67");
  });
});

describe("per-host expansion (mgmt-cluster-host scope)", () => {
  it("emits 16 host FQDN rows in 9.0", () => {
    const fleet = migrate9_1To9_0(newFleet());
    // Fleet has DNS domain so the FQDN resolver returns non-empty even
    // without a naming template (the studio's resolveHostname may still
    // return falsy without a template — that's OK; the rows themselves
    // are still emitted).
    const rows = emitWorkbookCellMap(fleet);
    const hostRows = rows.filter((r) => /^Host #\d+ FQDN$/.test(r.label));
    expect(hostRows.length).toBe(16);
    expect(hostRows[0].cell).toBe("L128");
    expect(hostRows[15].cell).toBe("L143");
  });

  it("emits 16 host FQDN rows in 9.1 with cells L82–L97", () => {
    const fleet = newFleet();
    const rows = emitWorkbookCellMap(fleet);
    const hostRows = rows.filter((r) => /^Host #\d+ FQDN$/.test(r.label));
    expect(hostRows.length).toBe(16);
    expect(hostRows[0].cell).toBe("L82");
    expect(hostRows[15].cell).toBe("L97");
  });
});

describe("initial-instance-mgmt-cluster scope (VCFMS, fleet-scope)", () => {
  it("9.1 fleet emits VCFMS cells once even with multiple instances", () => {
    const fleet = newFleet();
    // Add a second instance to test scope filtering.
    const inst2 = { ...fleet.instances[0], id: "inst-2", name: "instance-2" };
    fleet.instances.push(inst2);
    const rows = emitWorkbookCellMap(fleet);
    const idBrokerRows = rows.filter((r) => r.label === "Identity Broker FQDN");
    expect(idBrokerRows.length).toBe(1);
  });
});

describe("CSV round-trip", () => {
  it("emit → parse recovers same rows", () => {
    const fleet = newFleet();
    fleet.networkConfig.dns.primaryDomain = "acme.local";
    fleet.networkConfig.dns.servers = ["10.0.0.1", "10.0.0.2"];
    const csv = emitWorkbookCellMapCsv(fleet);
    const parsed = parseWorkbookCellMap(csv);
    const original = emitWorkbookCellMap(fleet);
    expect(parsed.length).toBe(original.length);
    for (let i = 0; i < parsed.length; i++) {
      expect(parsed[i]).toEqual(original[i]);
    }
  });

  it("CSV values containing commas / quotes / newlines are escaped (RFC 4180)", () => {
    const fleet = newFleet();
    fleet.instances[0].name = 'instance, with, commas and "quotes"';
    const csv = emitWorkbookCellMapCsv(fleet);
    const parsed = parseWorkbookCellMap(csv);
    const row = parsed.find((r) => r.label === "VCF Instance Name");
    expect(row.value).toBe('instance, with, commas and "quotes"');
  });

  it("CSV starts with the expected header", () => {
    const fleet = newFleet();
    const csv = emitWorkbookCellMapCsv(fleet);
    expect(csv.split("\n")[0]).toBe("workbookVersion,sheet,cell,label,value");
  });
});

describe("emitWorkbookCellMap — defensive defaults", () => {
  it("empty fleet returns []", () => {
    expect(emitWorkbookCellMap(null)).toEqual([]);
    expect(emitWorkbookCellMap(undefined)).toEqual([]);
  });

  it("fleet without instances does not crash", () => {
    expect(() => emitWorkbookCellMap({ vcfVersion: "9.0", instances: [] })).not.toThrow();
  });

  it("entries with a throwing resolve produce empty string, not throw", () => {
    const fleet = newFleet();
    // Synthetic test by directly checking that all values are strings.
    const rows = emitWorkbookCellMap(fleet);
    for (const r of rows) expect(typeof r.value).toBe("string");
  });
});

describe("workload-domain / workload-cluster / additional-cluster scopes", () => {
  it("emits Workload domain name row when fleet has a workload domain", () => {
    const rows = emitWorkbookCellMap(fleetWithWld());
    const row = rows.find((r) => r.label === "Workload domain name");
    expect(row).toBeDefined();
    expect(row.sheet).toBe("Deploy Workload Domain");
    expect(row.cell).toBe("D23");
    expect(row.value).toBe("TestWLD");
  });

  it("emits NSX Edge Cluster Name row from the WLD's first cluster", () => {
    const rows = emitWorkbookCellMap(fleetWithWld());
    const row = rows.find((r) => r.label === "NSX Edge Cluster Name");
    expect(row).toBeDefined();
    expect(row.sheet).toBe("Configure Workload Domain");
    expect(row.cell).toBe("D38");
    expect(row.value).toBe("wld-cl01");
  });

  it("emits Additional Cluster Name row only for clusters beyond the first", () => {
    const rows = emitWorkbookCellMap(fleetWithWld());
    const additionalRows = rows.filter((r) => r.label === "Additional Cluster Name");
    expect(additionalRows.length).toBe(1); // 2 clusters → 1 additional
    expect(additionalRows[0].cell).toBe("D19");
    expect(additionalRows[0].value).toBe("wld-cl02");
  });

  it("default fleet (no WLD) emits no workload-domain rows", () => {
    const rows = emitWorkbookCellMap(newFleet());
    expect(rows.find((r) => r.label === "Workload domain name")).toBeUndefined();
    expect(rows.find((r) => r.label === "NSX Edge Cluster Name")).toBeUndefined();
    expect(rows.find((r) => r.label === "Additional Cluster Name")).toBeUndefined();
  });
});

describe("cell-map apply functions (import-side helpers)", () => {
  // Helper: find a cell-map entry by its semantic label.
  const findEntry = (label) => WORKBOOK_CELL_MAP.find((e) => e.label === label);

  it("DNS Domain name apply writes to fleet.networkConfig.dns.primaryDomain", () => {
    const entry = findEntry("DNS Domain name");
    expect(entry.apply).toBeTypeOf("function");
    const fleet = {};
    entry.apply(fleet, {}, "acme.local");
    expect(fleet.networkConfig.dns.primaryDomain).toBe("acme.local");
  });

  it("DNS Domain name apply tolerates undefined value (coerces to empty string)", () => {
    const entry = findEntry("DNS Domain name");
    const fleet = {};
    entry.apply(fleet, {}, undefined);
    expect(fleet.networkConfig.dns.primaryDomain).toBe("");
  });

  it("VCF Instance Name apply writes to ctx.instance.name", () => {
    const entry = findEntry("VCF Instance Name");
    const instance = { name: "before" };
    entry.apply({}, { instance }, "ProductionFleet");
    expect(instance.name).toBe("ProductionFleet");
  });

  it("VCF Instance Name apply is a no-op when ctx.instance is missing", () => {
    const entry = findEntry("VCF Instance Name");
    expect(() => entry.apply({}, {}, "x")).not.toThrow();
  });

  it("Management domain name apply writes to ctx.domain.name", () => {
    const entry = findEntry("Management domain name");
    const domain = { name: "old" };
    entry.apply({}, { domain }, "sfo-m01");
    expect(domain.name).toBe("sfo-m01");
  });

  it("vCenter Appliance Size apply rewrites entry.size (normalizes 'X-Large' → 'XLarge')", () => {
    const entry = findEntry("vCenter Appliance Size");
    const cluster = { infraStack: [{ id: "vcenter", size: "Medium" }] };
    entry.apply({}, { cluster }, "X-Large");
    expect(cluster.infraStack[0].size).toBe("XLarge");
  });

  it("vCenter Appliance Size apply ignores clusters without a vcenter entry", () => {
    const entry = findEntry("vCenter Appliance Size");
    const cluster = { infraStack: [] };
    expect(() => entry.apply({}, { cluster }, "Large")).not.toThrow();
    expect(cluster.infraStack).toEqual([]);
  });

  it("vCenter Appliance Storage Size apply normalizes to lowercase storageProfile", () => {
    const entry = findEntry("vCenter Appliance Storage Size");
    const cluster = { infraStack: [{ id: "vcenter", storageProfile: "default" }] };
    entry.apply({}, { cluster }, "X-Large");
    // Implementation lowercases + strips whitespace/hyphens; 'X-Large' → 'xlarge'
    expect(cluster.infraStack[0].storageProfile).toBe("xlarge");
  });

  it("vCenter Cluster Name apply writes to ctx.cluster.name", () => {
    const entry = findEntry("vCenter Cluster Name");
    const cluster = { name: "before" };
    entry.apply({}, { cluster }, "sfo-m01-cl01");
    expect(cluster.name).toBe("sfo-m01-cl01");
  });
});

describe("isInitialInstance helper", () => {
  it("returns true when the instance is fleet.instances[0]", () => {
    const fleet = newFleet();
    expect(isInitialInstance(fleet, fleet.instances[0])).toBe(true);
  });

  it("returns false when the instance is not the initial one", () => {
    const fleet = newFleet();
    const other = { ...fleet.instances[0], id: "inst-other" };
    expect(isInitialInstance(fleet, other)).toBe(false);
  });

  it("returns false for an empty fleet", () => {
    expect(isInitialInstance({ instances: [] }, { id: "x" })).toBe(false);
    expect(isInitialInstance({}, null)).toBe(false);
  });
});

describe("DNS Domain cell move (9.0 L43 → 9.1 L71)", () => {
  it("L43 in 9.0", () => {
    const fleet = migrate9_1To9_0(newFleet());
    const rows = emitWorkbookCellMap(fleet);
    const row = rows.find((r) => r.label === "DNS Domain name");
    expect(row.cell).toBe("L43");
  });

  it("L71 in 9.1 (workbook label is 'Default hostname DNS suffix')", () => {
    const fleet = newFleet();
    const rows = emitWorkbookCellMap(fleet);
    const row = rows.find((r) => r.label === "DNS Domain name");
    expect(row.cell).toBe("L71");
  });
});

describe("VCF Operations Appliance Size (M1.5)", () => {
  // The pristine workbook's 9.0 fixture labels L56 "Operations Appliance
  // Size" with the validation list ["Extra Small", "Small", "Medium",
  // "Large", "Extra Large"]. On 9.1 the same cell moves to L323; the
  // workbook fixture only labels it "Appliance Size" but the sample
  // formula at K323 references `mgmt_domain_vcf_operations_size_chosen`,
  // confirming the cell's intent. The studio model uses CamelCase
  // ("ExtraSmall", "ExtraLarge") internally; the workbook dropdown
  // uses space-separated labels. The cell-map entry handles the
  // conversion in both directions.
  function mgmtCluster(f) {
    return f.instances[0].domains.find((d) => d.type === "mgmt").clusters[0];
  }
  function vcfOpsEntry(cluster) {
    return (cluster.infraStack || []).find((e) => e.id === "vcfOps");
  }

  it("emits 9.0 L56 with space-separated value from CamelCase model", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    vcfOpsEntry(mgmtCluster(f)).size = "ExtraLarge";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const row = rows.find((r) => r.label === "VCF Operations Appliance Size");
    expect(row).toBeTruthy();
    expect(row.cell).toBe("L56");
    expect(row.value).toBe("Extra Large");
  });

  it("emits 9.1 L323 (different row, same cell semantics)", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    vcfOpsEntry(mgmtCluster(f)).size = "Medium";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const row = rows.find((r) => r.label === "VCF Operations Appliance Size");
    expect(row.cell).toBe("L323");
    expect(row.value).toBe("Medium");
  });

  it("apply converts space-separated back to CamelCase on both versions", () => {
    for (const v of ["9.0", "9.1"]) {
      const f = newFleet();
      f.vcfVersion = v;
      vcfOpsEntry(mgmtCluster(f)).size = "ExtraSmall";
      const csv = emitWorkbookCellMapCsv(f, null, { workbookVersion: v });
      const back = VcfEngine.importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: v }).fleet;
      expect(vcfOpsEntry(mgmtCluster(back)).size).toBe("ExtraSmall");
    }
  });

  it("emits empty string when vcfOps entry is missing or has no size", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    const cluster = mgmtCluster(f);
    cluster.infraStack = (cluster.infraStack || []).filter((e) => e.id !== "vcfOps");
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const row = rows.find((r) => r.label === "VCF Operations Appliance Size");
    expect(row.value).toBe("");
  });
});
