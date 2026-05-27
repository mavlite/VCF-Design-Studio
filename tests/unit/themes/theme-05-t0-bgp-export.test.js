// Theme 5 — T0 BGP / routing detail workbook export
//
// EXPORT-ONLY work. The studio's t0Gateways[0].{asnLocal, bgpPeers, name,
// haMode, bgpEnabled} flow into Configure Management Domain and Configure
// Workload Domain sheets. UI input mechanisms landed in Theme 5a (#52).
//
// Scope shipped:
//   - T0 Local ASN, Gateway Routing Type (BGP/STATIC enum) — both versions
//   - T0 Gateway Name, HA Mode (Active Active/Active Standby) — 9.1 only
//   - Per-peer BGP detail for slots 1+2 (AZ1 TOR1/TOR2):
//       Peer IP, Peer ASN, MTU, BFD (slot 1 only — slot 2 BFD is a workbook
//       formula)
//   - Bgp peer passwords continue to flow through the existing vault path
//     (PASSWORD_POLICY['bgp-peer'] entries at D164/D171 mgmt), NOT the CSV
//
// Deferred:
//   - Slots 3+4 (AZ2 stretched) — needs AZ2 peer modeling
//   - Gateway Interface VLAN/IP — needs cluster.networks.uplinks[] UI editor

import { describe, it, expect } from "vitest";
import XLSX from "xlsx";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  importWorkbookCellMap,
  parseWorkbookCellMap,
  emitWorkbookXlsx,
  emitWorkbookXlsxWithPasswords,
  generateWorkbookVault,
  migrateFleet,
  WORKBOOK_CELL_MAP,
} = VcfEngine;

function fleetWithT0(version, { mgmtPeers = [], wldPeers = [] } = {}) {
  const fleet = newFleet();
  fleet.vcfVersion = version;
  // Mgmt domain — populate first cluster's first T0
  const mgmtCluster = fleet.instances[0].domains[0].clusters[0];
  mgmtCluster.t0Gateways = [{
    id: "t0-mgmt-1",
    name: "t0-mgmt",
    haMode: "active-active",
    bgpEnabled: true,
    asnLocal: 65001,
    edgeNodeKeys: [],
    uplinksPerEdge: [],
    bgpPeers: mgmtPeers,
  }];
  // Workload domain
  const wld = newWorkloadDomain("WLD-A");
  wld.clusters = [newWorkloadCluster("wld-cl01")];
  wld.clusters[0].t0Gateways = [{
    id: "t0-wld-1",
    name: "t0-wld",
    haMode: "active-standby",
    bgpEnabled: true,
    asnLocal: 65002,
    edgeNodeKeys: [],
    uplinksPerEdge: [],
    bgpPeers: wldPeers,
  }];
  fleet.instances[0].domains.push(wld);
  return fleet;
}

const peer = (overrides = {}) => ({
  id: "peer-" + Math.random().toString(36).slice(2, 10),
  name: null, ip: null, asn: null, mtu: null, bfdEnabled: false, ...overrides,
});

describe("Theme 5 — T0 BGP cell-map entries (schema)", () => {
  it("WORKBOOK_CELL_MAP contains T0 Local ASN entries on both sheets", () => {
    const mgmtAsn = WORKBOOK_CELL_MAP.filter((e) => e.label === "T0 Local ASN (Mgmt)");
    const wldAsn = WORKBOOK_CELL_MAP.filter((e) => e.label === "T0 Local ASN (WLD)");
    expect(mgmtAsn).toHaveLength(1);
    expect(wldAsn).toHaveLength(1);
    expect(mgmtAsn[0].workbookVersions).toEqual(["9.0", "9.1"]);
    expect(wldAsn[0].workbookVersions).toEqual(["9.0", "9.1"]);
  });

  it("Gateway Name + HA Mode entries are dual-version (9.0 + 9.1) with cellByVersion routing", () => {
    const gw = WORKBOOK_CELL_MAP.filter((e) => /^T0 Gateway Name/.test(e.label));
    const ha = WORKBOOK_CELL_MAP.filter((e) => /^T0 HA Mode/.test(e.label));
    expect(gw).toHaveLength(2);
    expect(ha).toHaveLength(2);
    for (const e of [...gw, ...ha]) {
      expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
      expect(e.cellByVersion).toBeTruthy();
      expect(e.cellByVersion["9.0"]).toMatch(/^D\d+$/);
      expect(e.cellByVersion["9.1"]).toMatch(/^D\d+$/);
    }
  });

  it("BFD entries cover slot 1 only (slot 2 is a workbook formula)", () => {
    const bfd = WORKBOOK_CELL_MAP.filter((e) => /BFD/.test(e.label));
    expect(bfd).toHaveLength(2); // mgmt slot 1 + wld slot 1
    for (const e of bfd) expect(e.label).toMatch(/#1 BFD/);
  });

  it("non-BFD per-peer fields cover slots 1 and 2 on both sheets", () => {
    // Filter on "BGP Peer #N <field>" pattern so we count only this
    // theme's per-peer entries — substring matches alone would collide
    // with sibling themes that happen to share field names (e.g.
    // theme 4's "Edge Tunnel Endpoint MTU").
    for (const k of ["Peer IP", "BGP Peer ASN", "MTU"]) {
      const entries = WORKBOOK_CELL_MAP.filter((e) =>
        /BGP Peer #\d/.test(e.label) && e.label.includes(k)
      );
      expect(entries, `field ${k}`).toHaveLength(4); // 2 sheets × 2 slots
    }
  });
});

describe("Theme 5 — emit produces expected values (9.0 + 9.1)", () => {
  it.each(["9.0", "9.1"])("ASN, routing type, and peer detail land in their cells (%s)", (version) => {
    const fleet = fleetWithT0(version, {
      mgmtPeers: [
        peer({ name: "uplink-a", ip: "10.0.1.1", asn: 65100, mtu: 9000, bfdEnabled: true }),
        peer({ name: "uplink-b", ip: "10.0.1.2", asn: 65100, mtu: 9000, bfdEnabled: false }),
      ],
      wldPeers: [
        peer({ name: "wld-uplink", ip: "10.0.2.1", asn: 65200, mtu: 9000, bfdEnabled: true }),
      ],
    });
    const rows = emitWorkbookCellMap(fleet, null, { workbookVersion: version });
    const byLabel = (label) => rows.find((r) => r.label === label);

    expect(byLabel("T0 Local ASN (Mgmt)")?.value).toBe("65001");
    expect(byLabel("T0 Local ASN (WLD)")?.value).toBe("65002");
    expect(byLabel("T0 Gateway Routing Type (Mgmt)")?.value).toBe("BGP");
    expect(byLabel("T0 Gateway Routing Type (WLD)")?.value).toBe("BGP");

    expect(byLabel("T0 BGP Peer #1 BGP Peer IP (Mgmt)")?.value).toBe("10.0.1.1");
    expect(byLabel("T0 BGP Peer #1 BGP Peer ASN (Mgmt)")?.value).toBe("65100");
    expect(byLabel("T0 BGP Peer #1 MTU (Mgmt)")?.value).toBe("9000");
    expect(byLabel("T0 BGP Peer #1 BFD (Mgmt)")?.value).toBe("Selected");

    expect(byLabel("T0 BGP Peer #2 BGP Peer IP (Mgmt)")?.value).toBe("10.0.1.2");
    expect(byLabel("T0 BGP Peer #2 BGP Peer ASN (Mgmt)")?.value).toBe("65100");
    expect(byLabel("T0 BGP Peer #2 MTU (Mgmt)")?.value).toBe("9000");

    expect(byLabel("T0 BGP Peer #1 BGP Peer IP (WLD)")?.value).toBe("10.0.2.1");
    expect(byLabel("T0 BGP Peer #1 BFD (WLD)")?.value).toBe("Selected");
  });

  it("9.1 + 9.0 both stamp Gateway Name + HA Mode (dual-version)", () => {
    const fleet = fleetWithT0("9.1");
    const rows = emitWorkbookCellMap(fleet, null, { workbookVersion: "9.1" });
    const byLabel = (label) => rows.find((r) => r.label === label);
    expect(byLabel("T0 Gateway Name (Mgmt)")?.value).toBe("t0-mgmt");
    expect(byLabel("T0 HA Mode (Mgmt)")?.value).toBe("Active Active");
    expect(byLabel("T0 Gateway Name (WLD)")?.value).toBe("t0-wld");
    expect(byLabel("T0 HA Mode (WLD)")?.value).toBe("Active Standby");
    // 9.0 stamps to the 9.0 row addresses (D153/D154 Mgmt, D96/D97 WLD).
    const rows90 = emitWorkbookCellMap(fleetWithT0("9.0"), null, { workbookVersion: "9.0" });
    const find90 = (sheet, cell) => rows90.find((r) => r.sheet === sheet && r.cell === cell);
    expect(find90("Configure Management Domain", "D153")?.value).toBe("t0-mgmt");
    expect(find90("Configure Management Domain", "D154")?.value).toBe("Active Active");
    expect(find90("Configure Workload Domain", "D96")?.value).toBe("t0-wld");
    expect(find90("Configure Workload Domain", "D97")?.value).toBe("Active Standby");
  });

  it("empty bgpPeers[] yields blank cells without errors", () => {
    const fleet = fleetWithT0("9.0");
    const rows = emitWorkbookCellMap(fleet, null, { workbookVersion: "9.0" });
    const peerIpMgmt1 = rows.find((r) => r.label === "T0 BGP Peer #1 BGP Peer IP (Mgmt)");
    expect(peerIpMgmt1).toBeDefined();
    expect(peerIpMgmt1.value).toBe("");
  });

  it("bfdEnabled=false maps to 'Unselected'", () => {
    const fleet = fleetWithT0("9.0", {
      mgmtPeers: [peer({ ip: "10.0.1.1", bfdEnabled: false })],
    });
    const rows = emitWorkbookCellMap(fleet, null, { workbookVersion: "9.0" });
    const bfd = rows.find((r) => r.label === "T0 BGP Peer #1 BFD (Mgmt)");
    expect(bfd.value).toBe("Unselected");
  });

  it("bgpEnabled=false on T0 maps routing type to STATIC", () => {
    const fleet = fleetWithT0("9.0");
    fleet.instances[0].domains[0].clusters[0].t0Gateways[0].bgpEnabled = false;
    const rows = emitWorkbookCellMap(fleet, null, { workbookVersion: "9.0" });
    const rt = rows.find((r) => r.label === "T0 Gateway Routing Type (Mgmt)");
    expect(rt.value).toBe("STATIC");
  });
});

describe("Theme 5 — BGP peer passwords stay off the CSV", () => {
  it("emitWorkbookCellMap does not emit rows for any bgp-peer password cells", () => {
    const fleet = fleetWithT0("9.0", {
      mgmtPeers: [peer({ ip: "10.0.1.1", asn: 65100 })],
    });
    const rows = emitWorkbookCellMap(fleet, null, { workbookVersion: "9.0" });
    // "BGP Peer Password" is the verifyLabel/label fragment used by the
    // existing passwordKind entries at engine.js:3318-3336. Auto-generate
    // toggle cells contain "Password" but are not what we're guarding.
    const bgpPasswordRows = rows.filter((r) => /BGP Peer Password/i.test(r.label));
    expect(bgpPasswordRows).toEqual([]);
  });

  it("generateWorkbookVault produces bgp-peer credentials with strong, alphanumeric passwords", () => {
    const fleet = fleetWithT0("9.0", {
      mgmtPeers: [peer({ ip: "10.0.1.1", asn: 65100 })],
    });
    const { vault } = generateWorkbookVault(fleet, { workbookVersion: "9.0" });
    const bgpEntries = vault.credentials.filter((c) => c.credentialType === "bgp-peer");
    expect(bgpEntries.length).toBeGreaterThanOrEqual(2);
    for (const e of bgpEntries) {
      expect(e.password).toMatch(/^[A-Za-z0-9]{24}$/);
    }
  });
});

describe("Theme 5 — import round-trip", () => {
  it("CSV round-trip via parseWorkbookCellMap reconstructs ASN + peer detail", () => {
    const fleet = fleetWithT0("9.0", {
      mgmtPeers: [
        peer({ ip: "10.0.1.1", asn: 65100, mtu: 9000, bfdEnabled: true }),
        peer({ ip: "10.0.1.2", asn: 65100, mtu: 1500, bfdEnabled: false }),
      ],
    });
    const csv = emitWorkbookCellMapCsv(fleet, null, { workbookVersion: "9.0" });
    const rows = parseWorkbookCellMap(csv);
    expect(rows.length).toBeGreaterThan(0);

    const draft = importWorkbookCellMap(rows, { workbookVersion: "9.0" }).fleet;
    const t0 = draft.instances[0].domains[0].clusters[0].t0Gateways[0];
    expect(t0.asnLocal).toBe(65001);
    expect(t0.bgpEnabled).toBe(true);
    expect(t0.bgpPeers).toHaveLength(2);
    expect(t0.bgpPeers[0]).toMatchObject({ ip: "10.0.1.1", asn: 65100, mtu: 9000, bfdEnabled: true });
    expect(t0.bgpPeers[1]).toMatchObject({ ip: "10.0.1.2", asn: 65100, mtu: 1500, bfdEnabled: false });
  });

  it("9.1 round-trip preserves Gateway Name + HA Mode", () => {
    const fleet = fleetWithT0("9.1", {
      mgmtPeers: [peer({ ip: "10.0.1.1", asn: 65100 })],
    });
    const csv = emitWorkbookCellMapCsv(fleet, null, { workbookVersion: "9.1" });
    const rows = parseWorkbookCellMap(csv);
    const draft = importWorkbookCellMap(rows, { workbookVersion: "9.1" }).fleet;
    const t0 = draft.instances[0].domains[0].clusters[0].t0Gateways[0];
    expect(t0.name).toBe("t0-mgmt");
    expect(t0.haMode).toBe("active-active");
  });

  // HA Mode apply normalizes input to handle the common accidental
  // forms a user might enter when hand-editing a CSV: case-insensitive,
  // and dash/slash separators collapse to spaces. Abbreviations like
  // "AA" stay rejected (too ambiguous). Out-of-enum input leaves
  // haMode untouched.
  it("HA Mode apply accepts space/dash/slash separators case-insensitively; rejects abbreviations", () => {
    const entry = WORKBOOK_CELL_MAP.find((e) => e.label === "T0 HA Mode (Mgmt)");
    function applyTo(value) {
      const f = newFleet();
      f.vcfVersion = "9.1";
      const c = f.instances[0].domains[0].clusters[0];
      entry.apply(f, { instance: f.instances[0], cluster: c }, value);
      return c.t0Gateways && c.t0Gateways[0] && c.t0Gateways[0].haMode;
    }
    // Canonical forms (case-insensitive accept).
    expect(applyTo("Active Active")).toBe("active-active");
    expect(applyTo("Active Standby")).toBe("active-standby");
    expect(applyTo("active active")).toBe("active-active");
    expect(applyTo("ACTIVE STANDBY")).toBe("active-standby");
    // Dash + slash separators normalize to canonical (improvement
    // shipped with this commit — accepts the dashed form Excel may
    // produce when reformatting cell contents).
    expect(applyTo("Active-Active")).toBe("active-active");
    expect(applyTo("active-standby")).toBe("active-standby");
    expect(applyTo("Active / Active")).toBe("active-active");
    expect(applyTo("active/standby")).toBe("active-standby");
    // Abbreviations stay rejected (ambiguous). State stays at factory
    // default "active-standby".
    expect(applyTo("AA")).toBe("active-standby");
    expect(applyTo("AS")).toBe("active-standby");
    // Truly nonsense input also rejected.
    expect(applyTo("gibberish")).toBe("active-standby");
  });
});

describe("Theme 5 — migrateFleet idempotency post-import", () => {
  it("migrateFleet on an imported draft is stable on a second pass", () => {
    const fleet = fleetWithT0("9.0", {
      mgmtPeers: [peer({ ip: "10.0.1.1", asn: 65100, mtu: 9000, bfdEnabled: true })],
      wldPeers: [peer({ ip: "10.0.2.1", asn: 65200, mtu: 9000, bfdEnabled: false })],
    });
    const csv = emitWorkbookCellMapCsv(fleet, null, { workbookVersion: "9.0" });
    const rows = parseWorkbookCellMap(csv);
    const draft = importWorkbookCellMap(rows, { workbookVersion: "9.0" }).fleet;
    // newFleet() doesn't stamp `version` (only vcfVersion). A real save/load
    // round-trip always writes "vcf-sizer-v9" to the persisted JSON, so
    // simulate that here — otherwise migrateFleet runs the legacy v3 chain
    // and drops the instance shape.
    draft.version = "vcf-sizer-v9";
    const a = migrateFleet(draft);
    const b = migrateFleet(a);
    expect(b.instances[0].domains[0].clusters[0].t0Gateways[0])
      .toEqual(a.instances[0].domains[0].clusters[0].t0Gateways[0]);
  });
});
