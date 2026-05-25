// Tests for the workbook import path.
// Covers readWorkbookXlsxAsCellMapRows, importWorkbookCellMap, and
// computeReconcileDiff. Greenfield-only — these helpers produce a draft
// fleet that the UI commits via setFleet().
import { describe, it, expect } from "vitest";
import XLSX from "xlsx";
import VcfEngine from "../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  migrate9_0To9_1,
  migrate9_1To9_0,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  emitWorkbookXlsx,
  parseWorkbookCellMap,
  readWorkbookXlsxAsCellMapRows,
  importWorkbookCellMap,
  computeReconcileDiff,
  WORKBOOK_CELL_MAP,
} = VcfEngine;

// Build a synthetic pristine workbook with every cell-map target populated
// as a user-input placeholder; used by the .xlsx round-trip tests so we
// can stamp + parse without an external Broadcom file.
function buildSyntheticPristine(version) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Prerequisite Checklist"]]), "Prerequisite Checklist");
  const sheet2 = XLSX.utils.aoa_to_sheet([[]]);
  sheet2["J16"] = { t: "s", v: version + ".0.0" };
  sheet2["!ref"] = "A1:J16";
  XLSX.utils.book_append_sheet(wb, sheet2, "VCF & VVF Planning");
  const sheetCells = new Map();
  for (const entry of WORKBOOK_CELL_MAP) {
    if (!entry.workbookVersions.includes(version)) continue;
    const base = (entry.cellByVersion && entry.cellByVersion[version]) || entry.cell;
    const pattern = (entry.cellPatternByVersion && entry.cellPatternByVersion[version]) || entry.cellPattern;
    const addrs = [];
    if (pattern) {
      const n = typeof entry.expandsTo === "number" ? entry.expandsTo : 1;
      for (let i = 0; i < n; i++) {
        addrs.push(pattern.replace(/\{(\d+)\+i\}/g, (_, b) => String(parseInt(b, 10) + i)));
      }
    } else if (base) addrs.push(base);
    if (!sheetCells.has(entry.sheet)) sheetCells.set(entry.sheet, new Set());
    for (const a of addrs) sheetCells.get(entry.sheet).add(a);
  }
  for (const [name, cells] of sheetCells.entries()) {
    const sheet = XLSX.utils.aoa_to_sheet([[]]);
    let maxRow = 1, maxCol = 1;
    for (const addr of cells) {
      sheet[addr] = { t: "s", v: "" };
      const m = addr.match(/^([A-Z]+)(\d+)$/);
      if (m) {
        const row = parseInt(m[2], 10);
        const colIdx = m[1].split("").reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0);
        if (row > maxRow) maxRow = row;
        if (colIdx > maxCol) maxCol = colIdx;
      }
    }
    const lastCol = (() => {
      let n = maxCol, s = "";
      while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
      return s;
    })();
    sheet["!ref"] = `A1:${lastCol}${maxRow}`;
    XLSX.utils.book_append_sheet(wb, sheet, name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("importWorkbookCellMap — CSV round-trip", () => {
  it("recovers VCF Instance Name, DNS Domain, Management domain name from a 9.1 emit", () => {
    const original = newFleet();
    original.instances[0].name = "Production-East";
    original.instances[0].domains[0].name = "sfo-m01";
    original.networkConfig.dns.primaryDomain = "acme.local";

    const csv = emitWorkbookCellMapCsv(original);
    const rows = parseWorkbookCellMap(csv);
    const { fleet: recovered, version, applied, skipped } = importWorkbookCellMap(rows);

    expect(version).toBe("9.1");
    expect(recovered.instances[0].name).toBe("Production-East");
    expect(recovered.instances[0].domains[0].name).toBe("sfo-m01");
    expect(recovered.networkConfig.dns.primaryDomain).toBe("acme.local");
    expect(applied.length).toBeGreaterThanOrEqual(3);
    // The skipped count covers emit-only entries (host FQDNs, VCFMS pool
    // arithmetic, etc.) — non-zero is expected.
    expect(Array.isArray(skipped)).toBe(true);
  });

  it("recovers fields from a 9.0 emit (no VCFMS rows)", () => {
    const original = migrate9_1To9_0(newFleet());
    original.instances[0].name = "Legacy";
    original.networkConfig.dns.primaryDomain = "legacy.local";

    const csv = emitWorkbookCellMapCsv(original);
    const rows = parseWorkbookCellMap(csv);
    const { fleet: recovered, version } = importWorkbookCellMap(rows);

    expect(version).toBe("9.0");
    expect(recovered.vcfVersion).toBe("9.0");
    expect(recovered.instances[0].name).toBe("Legacy");
    expect(recovered.networkConfig.dns.primaryDomain).toBe("legacy.local");
  });

  it("vCenter Appliance Size round-trips through size normalization", () => {
    const original = newFleet();
    const vcenter = original.instances[0].domains[0].clusters[0].infraStack.find((e) => e.id === "vcenter");
    vcenter.size = "Large";

    const rows = emitWorkbookCellMap(original);
    const { fleet: recovered } = importWorkbookCellMap(rows);
    const recoveredVcenter = recovered.instances[0].domains[0].clusters[0].infraStack.find((e) => e.id === "vcenter");
    expect(recoveredVcenter.size).toBe("Large");
  });

  it("vCenter Cluster Name round-trips", () => {
    const original = newFleet();
    original.instances[0].domains[0].clusters[0].name = "sfo-m01-cl01";
    const rows = emitWorkbookCellMap(original);
    const { fleet: recovered } = importWorkbookCellMap(rows);
    expect(recovered.instances[0].domains[0].clusters[0].name).toBe("sfo-m01-cl01");
  });

  it("intentional emit-only entries surface a distinct skipped reason", () => {
    const fleet = newFleet();
    fleet.networkConfig.dns.primaryDomain = "acme.local";
    const rows = emitWorkbookCellMap(fleet);
    const { skipped } = importWorkbookCellMap(rows);
    // After broaden-apply, every cell-map entry either has an apply or
    // is explicitly tagged emitOnly: true. The skipped diagnostic
    // distinguishes the two — useful for future "what else needs apply?"
    // surveys.
    const intentionalSkips = skipped.filter((s) => /intentionally emit-only/.test(s.reason));
    expect(intentionalSkips.length).toBeGreaterThan(0);
  });
});

describe("importWorkbookCellMap — broadened apply coverage", () => {
  // These tests cover the round-trip for every cell-map entry that gained
  // an apply() function in the broaden-apply PR. Each test emits a fleet
  // with a non-default value for the field, runs it through emit + import,
  // and asserts the field comes back exactly.

  it("DNS Server #1 and #2 round-trip", () => {
    const original = newFleet();
    original.networkConfig.dns.servers = ["10.50.10.4", "10.50.10.5"];
    const rows = emitWorkbookCellMap(original);
    const { fleet: recovered } = importWorkbookCellMap(rows);
    expect(recovered.networkConfig.dns.servers[0]).toBe("10.50.10.4");
    expect(recovered.networkConfig.dns.servers[1]).toBe("10.50.10.5");
  });

  it("NTP Server #1 and #2 round-trip", () => {
    const original = newFleet();
    original.networkConfig.ntp.servers = ["10.50.10.121", "10.50.10.122"];
    const rows = emitWorkbookCellMap(original);
    const { fleet: recovered } = importWorkbookCellMap(rows);
    expect(recovered.networkConfig.ntp.servers[0]).toBe("10.50.10.121");
    expect(recovered.networkConfig.ntp.servers[1]).toBe("10.50.10.122");
  });

  it("Deployment model round-trips (Deploy HA → ha)", () => {
    const original = newFleet();
    original.instances[0].deploymentProfile = "ha";
    const rows = emitWorkbookCellMap(original);
    const { fleet: recovered } = importWorkbookCellMap(rows);
    expect(recovered.instances[0].deploymentProfile).toBe("ha");
  });

  it("Deployment model round-trips for haFederation", () => {
    const original = newFleet();
    original.instances[0].deploymentProfile = "haFederation";
    const rows = emitWorkbookCellMap(original);
    const { fleet: recovered } = importWorkbookCellMap(rows);
    expect(recovered.instances[0].deploymentProfile).toBe("haFederation");
  });

  it("NSX Manager Appliance Size round-trips", () => {
    const original = newFleet();
    const nsxMgr = original.instances[0].domains[0].clusters[0].infraStack.find((e) => e.id === "nsxMgr");
    nsxMgr.size = "Large";
    const rows = emitWorkbookCellMap(original);
    const { fleet: recovered } = importWorkbookCellMap(rows);
    const recoveredNsx = recovered.instances[0].domains[0].clusters[0].infraStack.find((e) => e.id === "nsxMgr");
    expect(recoveredNsx.size).toBe("Large");
  });

  it("Storage Option (Principal Storage) round-trips (vSAN-OSA)", () => {
    // Cell L116 / L58 used to store cluster.host.vsanArchitecture (a
    // phantom field, never wired to UI or factories). It now drives
    // the canonical cluster.storage.principalStorage field via the
    // updated cell-map entry — this assertion follows the new field.
    const original = newFleet();
    original.instances[0].domains[0].clusters[0].storage.principalStorage = "vSAN-OSA";
    const rows = emitWorkbookCellMap(original);
    const { fleet: recovered } = importWorkbookCellMap(rows);
    expect(recovered.instances[0].domains[0].clusters[0].storage.principalStorage).toBe("vSAN-OSA");
  });

  it("ESX Mgmt VLAN ID round-trips as a number", () => {
    const original = newFleet();
    original.instances[0].domains[0].clusters[0].networks.mgmt.vlan = 1611;
    const rows = emitWorkbookCellMap(original);
    const { fleet: recovered } = importWorkbookCellMap(rows);
    const v = recovered.instances[0].domains[0].clusters[0].networks.mgmt.vlan;
    expect(v).toBe(1611);
    expect(typeof v).toBe("number");
  });

  it("vMotion VLAN ID round-trips", () => {
    const original = newFleet();
    original.instances[0].domains[0].clusters[0].networks.vmotion.vlan = 1612;
    const rows = emitWorkbookCellMap(original);
    const { fleet: recovered } = importWorkbookCellMap(rows);
    expect(recovered.instances[0].domains[0].clusters[0].networks.vmotion.vlan).toBe(1612);
  });

  it("vSAN VLAN ID round-trips", () => {
    const original = newFleet();
    original.instances[0].domains[0].clusters[0].networks.vsan.vlan = 1613;
    const rows = emitWorkbookCellMap(original);
    const { fleet: recovered } = importWorkbookCellMap(rows);
    expect(recovered.instances[0].domains[0].clusters[0].networks.vsan.vlan).toBe(1613);
  });

  it("VCFMS Node IPv4 From sets pool.start", () => {
    const original = newFleet();
    original.instances[0].domains[0].clusters[0].networks.mgmt.pool = original.instances[0].domains[0].clusters[0].networks.mgmt.pool || {};
    original.instances[0].domains[0].clusters[0].networks.mgmt.pool.start = "10.50.10.31";
    const rows = emitWorkbookCellMap(original);
    const { fleet: recovered } = importWorkbookCellMap(rows);
    expect(recovered.instances[0].domains[0].clusters[0].networks.mgmt.pool.start).toBe("10.50.10.31");
  });

  it("Host FQDN expansion writes per-host hostname overrides, stripping DNS suffix", () => {
    // Manually populate the cell-map rows for host FQDNs since the default
    // resolveHostname returns empty without a naming template.
    const draft = newFleet();
    draft.networkConfig.dns.primaryDomain = "acme.local";
    // Build synthetic rows matching the host-FQDN cells in 9.1
    const rows = [
      { workbookVersion: "9.1", sheet: "Deploy Management Domain", cell: "L82", label: "Host #1 FQDN", value: "sfo-m01-esx01.acme.local" },
      { workbookVersion: "9.1", sheet: "Deploy Management Domain", cell: "L83", label: "Host #2 FQDN", value: "sfo-m01-esx02.acme.local" },
      { workbookVersion: "9.1", sheet: "Deploy Management Domain", cell: "L97", label: "Host #16 FQDN", value: "sfo-m01-esx16.acme.local" },
      // DNS suffix row so the importer knows what to strip
      { workbookVersion: "9.1", sheet: "Deploy Management Domain", cell: "L71", label: "DNS Domain name", value: "acme.local" },
    ];
    const { fleet: recovered } = importWorkbookCellMap(rows);
    const overrides = recovered.instances[0].domains[0].clusters[0].hostOverrides || [];
    expect(overrides[0]?.hostname).toBe("sfo-m01-esx01");
    expect(overrides[1]?.hostname).toBe("sfo-m01-esx02");
    expect(overrides[15]?.hostname).toBe("sfo-m01-esx16");
  });

  it("Host FQDN apply keeps the full value as hostname when no DNS suffix matches", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: "Deploy Management Domain", cell: "L82", label: "Host #1 FQDN", value: "standalone-hostname" },
    ];
    const { fleet: recovered } = importWorkbookCellMap(rows);
    const overrides = recovered.instances[0].domains[0].clusters[0].hostOverrides || [];
    expect(overrides[0]?.hostname).toBe("standalone-hostname");
  });

  it("Workload domain name round-trips when fleet has a workload domain", () => {
    const original = newFleet();
    const wld = newWorkloadDomain("Production-WLD");
    wld.clusters = [newWorkloadCluster("wld-cl01")];
    original.instances[0].domains.push(wld);
    const rows = emitWorkbookCellMap(original);
    const { fleet: recovered } = importWorkbookCellMap(rows);
    const recoveredWld = recovered.instances[0].domains.find((d) => d.type === "workload");
    expect(recoveredWld).toBeDefined();
    expect(recoveredWld.name).toBe("Production-WLD");
  });

  it("NSX Edge Cluster Name falls back to cluster.name when no T0 exists", () => {
    const original = newFleet();
    const wld = newWorkloadDomain("WLD");
    const wldCluster = newWorkloadCluster("edge-cluster-name-test");
    wld.clusters = [wldCluster];
    original.instances[0].domains.push(wld);
    const rows = emitWorkbookCellMap(original);
    const { fleet: recovered } = importWorkbookCellMap(rows);
    const recoveredCluster = recovered.instances[0].domains.find((d) => d.type === "workload").clusters[0];
    expect(recoveredCluster.name).toBe("edge-cluster-name-test");
  });

  it("Additional Cluster Name round-trips on a WLD's 2nd cluster", () => {
    const original = newFleet();
    const wld = newWorkloadDomain("WLD");
    wld.clusters = [newWorkloadCluster("wld-cl01"), newWorkloadCluster("additional-cluster-xyz")];
    original.instances[0].domains.push(wld);
    const rows = emitWorkbookCellMap(original);
    const { fleet: recovered } = importWorkbookCellMap(rows);
    const recoveredWld = recovered.instances[0].domains.find((d) => d.type === "workload");
    // After import the draft starts with one default-named additional
    // cluster ("wld-cluster-01" — set by the importer skeleton). The
    // additional-cluster apply renames that to whatever the workbook said.
    expect(recoveredWld.clusters.length).toBeGreaterThanOrEqual(1);
    const found = recoveredWld.clusters.find((c) => c.name === "additional-cluster-xyz");
    expect(found).toBeDefined();
  });

  it("emit-only entries (vCenter FQDN, VCFMS To, naming-derived FQDNs) report intentional skip", () => {
    const fleet = newFleet();
    fleet.networkConfig.dns.primaryDomain = "acme.local";
    const rows = emitWorkbookCellMap(fleet);
    const { skipped } = importWorkbookCellMap(rows);
    const intentional = skipped.filter((s) => /intentionally emit-only/.test(s.reason));
    expect(intentional.length).toBeGreaterThan(0);
    // Confirm the specific emit-only labels are accounted for
    const labels = intentional.map((s) => s.row.label);
    expect(labels.some((l) => /Instance Components FQDN|Identity Broker FQDN|VCF (Automation )?services runtime FQDN|vCenter Appliance FQDN|VCFMS Node IPv4 IP Range — To/.test(l))).toBe(true);
  });

  it("after the broaden, applied count exceeds the previous baseline of 6", () => {
    const original = newFleet();
    original.instances[0].name = "X";
    original.networkConfig.dns.primaryDomain = "x.local";
    original.networkConfig.dns.servers = ["1.1.1.1", "2.2.2.2"];
    const rows = emitWorkbookCellMap(original);
    const { applied } = importWorkbookCellMap(rows);
    // Was 6 before broaden; should be >= 10 now even on a near-default
    // fleet (DNS x2, NTP x2, instance name, mgmt domain name, deployment
    // model, vSAN arch, VLANs x3, vCenter size/storage/cluster name).
    expect(applied.length).toBeGreaterThanOrEqual(10);
  });
});

describe("importWorkbookCellMap — defensive guards", () => {
  it("throws on empty rows array", () => {
    expect(() => importWorkbookCellMap([])).toThrow(/rows array is empty/);
    expect(() => importWorkbookCellMap(null)).toThrow(/rows array is empty/);
  });

  it("throws on unsupported workbook version", () => {
    expect(() => importWorkbookCellMap([
      { workbookVersion: "8.5", sheet: "x", cell: "L1", label: "y", value: "z" },
    ])).toThrow(/unsupported workbook version/);
  });

  it("explicit options.workbookVersion overrides the row data", () => {
    const fleet = newFleet();
    const rows = emitWorkbookCellMap(fleet);
    const { version } = importWorkbookCellMap(rows, { workbookVersion: "9.0" });
    expect(version).toBe("9.0");
  });

  it("reports skipped rows with no matching cell-map entry", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: "Unknown Sheet", cell: "Z9999", label: "Fake", value: "noop" },
    ];
    const { skipped } = importWorkbookCellMap(rows);
    expect(skipped.length).toBe(1);
    expect(skipped[0].reason).toMatch(/no matching cell-map entry/);
  });
});

describe("readWorkbookXlsxAsCellMapRows", () => {
  it("reads stamped values back out of a 9.1 emit-then-stamp round-trip", () => {
    const fleet = newFleet();
    fleet.instances[0].name = "RoundTripFleet";
    fleet.networkConfig.dns.primaryDomain = "rt.local";

    const pristine = buildSyntheticPristine("9.1");
    const stampedBuf = emitWorkbookXlsx(fleet, null, pristine);
    // stampedBuf is a Uint8Array in Node
    const rows = readWorkbookXlsxAsCellMapRows(stampedBuf);
    expect(rows.length).toBeGreaterThan(0);
    const instanceNameRow = rows.find((r) => r.cell === "L67");
    expect(instanceNameRow).toBeDefined();
    expect(instanceNameRow.value).toBe("RoundTripFleet");
    const dnsRow = rows.find((r) => r.cell === "L71");
    expect(dnsRow.value).toBe("rt.local");
  });

  it("full round-trip — emit .xlsx → read → import → recover", () => {
    const original = newFleet();
    original.instances[0].name = "FullRoundTrip";
    original.instances[0].domains[0].name = "rt-mgmt";
    original.networkConfig.dns.primaryDomain = "rt.local";

    const pristine = buildSyntheticPristine("9.1");
    const stamped = emitWorkbookXlsx(original, null, pristine);
    const rows = readWorkbookXlsxAsCellMapRows(stamped);
    const { fleet: recovered, version } = importWorkbookCellMap(rows);

    expect(version).toBe("9.1");
    expect(recovered.instances[0].name).toBe("FullRoundTrip");
    expect(recovered.instances[0].domains[0].name).toBe("rt-mgmt");
    expect(recovered.networkConfig.dns.primaryDomain).toBe("rt.local");
  });

  it("throws when given an unparseable input", () => {
    expect(() => readWorkbookXlsxAsCellMapRows("not a workbook")).toThrow();
  });

  it("throws when Sheet2!J16 is missing (no version)", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "Only");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    expect(() => readWorkbookXlsxAsCellMapRows(buf)).toThrow(/couldn't detect workbook version/);
  });

  it("skips formula cells (treats them as unstamped)", () => {
    const fleet = newFleet();
    fleet.instances[0].name = "X";
    const pristine = buildSyntheticPristine("9.1");
    const stamped = emitWorkbookXlsx(fleet, null, pristine);
    // Inject a formula at L68 (Management domain name) post-stamp; the
    // reader should ignore it.
    const wb = XLSX.read(stamped, { type: "array", cellFormula: true });
    wb.Sheets["Deploy Management Domain"]["L68"] = { t: "s", v: "=SAMPLE", f: "SAMPLE" };
    const buf2 = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const rows = readWorkbookXlsxAsCellMapRows(buf2);
    expect(rows.find((r) => r.cell === "L68")).toBeUndefined();
  });

  it("skips blank cells (no false-positive empty rows)", () => {
    const fleet = newFleet();
    // Leave most fields at default — many emit as blank strings.
    const pristine = buildSyntheticPristine("9.1");
    const stamped = emitWorkbookXlsx(fleet, null, pristine);
    const rows = readWorkbookXlsxAsCellMapRows(stamped);
    for (const r of rows) {
      expect(r.value).not.toBe("");
      expect(r.value).not.toBeNull();
    }
  });
});

describe("computeReconcileDiff", () => {
  it("returns [] for a clean version-matched fleet", () => {
    const fleet = newFleet();
    expect(computeReconcileDiff(fleet)).toEqual([]);
  });

  it("flags VCFMS entries when downgrading a 9.1 fleet to 9.0", () => {
    const fleet = newFleet(); // 9.1 with VCFMS on initial-instance mgmt cluster
    const diff = computeReconcileDiff(fleet, "9.0");
    expect(diff.length).toBeGreaterThan(0);
    const vcfmsEntries = diff.filter((d) => /vcfms/i.test(d.entryId));
    expect(vcfmsEntries.length).toBeGreaterThan(0);
    for (const e of vcfmsEntries) {
      expect(e.reason).toMatch(/not available in VCF 9\.0/);
    }
  });

  it("returns [] when targetVersion matches fleet.vcfVersion (default)", () => {
    const fleet90 = migrate9_1To9_0(newFleet());
    expect(computeReconcileDiff(fleet90)).toEqual([]);
  });

  it("handles fleet with no clusters gracefully", () => {
    expect(computeReconcileDiff({ vcfVersion: "9.1", instances: [] })).toEqual([]);
    expect(computeReconcileDiff(null)).toEqual([]);
  });

  it("each entry carries instance/domain/cluster context for the UI", () => {
    const fleet = newFleet();
    const diff = computeReconcileDiff(fleet, "9.0");
    if (diff.length > 0) {
      const e = diff[0];
      expect(e.instanceId).toBeDefined();
      expect(e.instanceName).toBeDefined();
      expect(e.domainId).toBeDefined();
      expect(e.domainName).toBeDefined();
      expect(e.clusterId).toBeDefined();
      expect(e.clusterName).toBeDefined();
      expect(e.entryId).toBeDefined();
      expect(e.applianceLabel).toBeDefined();
      expect(e.stack).toMatch(/^(infraStack|wldStack)$/);
    }
  });
});
