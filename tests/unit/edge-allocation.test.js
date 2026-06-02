// NSX Edge IP assignment/allocation + overlay pool — engine round-trip tests.
// Spec: docs/superpowers/specs/2026-06-01-nsx-edge-allocation-design.md
// PR-1 = the 6 allocation/assignment dropdowns (cluster-level). PR-2 adds the
// overlay-pool fields.
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const { WORKBOOK_CELL_MAP, migrateFleet, createEdgeCluster } = VcfEngine;

function entryByLabel(label) { return WORKBOOK_CELL_MAP.find((m) => m.label === label); }
function cellFor(e, ver) { return (e.cellByVersion && e.cellByVersion[ver]) || e.cell; }

describe("edgeCluster allocation fields — factory + migrate", () => {
  it("createEdgeCluster carries the 6 allocation/assignment defaults", () => {
    const ec = createEdgeCluster();
    expect(ec.hostGroupAffinity).toBe("No");
    expect(ec.mgmtIpAssignment).toBe("IPv4 Only");
    expect(ec.mgmtIpAllocation).toBe("DHCP");
    expect(ec.useClusterHostOverlay).toBe("Unselected");
    expect(ec.tepIpAddressType).toBe("IPv4");
    expect(ec.tepIpAllocation).toBe("DHCP");
  });

  it("migrateFleet backfills the new fields and preserves hand-set values", () => {
    const f = migrateFleet({ version: "vcf-sizer-v9", instances: [
      { id: "i1", domains: [{ type: "mgmt", clusters: [
        { id: "c1", edgeCluster: { name: "ec", tepIpAllocation: "IP Pool" } },
      ] }] },
    ] });
    const ec = f.instances[0].domains[0].clusters[0].edgeCluster;
    expect(ec.tepIpAllocation).toBe("IP Pool");      // preserved
    expect(ec.mgmtIpAllocation).toBe("DHCP");          // backfilled
    expect(ec.hostGroupAffinity).toBe("No");           // backfilled
  });
});

describe("edge allocation cell-map entries (PR-1)", () => {
  // [label, sheet, scope, field, cell90|null, cell91, verifyLabel, dataValidation]
  const ROWS = [
    // Configure Management Domain
    ["Edge Host Group Affinity (Mgmt)",    "Configure Management Domain", "mgmt-cluster",     "hostGroupAffinity",     "D102", "D102", "Host Group Affinity", ["Yes","No"]],
    ["Edge Mgmt IP Assignment (Mgmt)",     "Configure Management Domain", "mgmt-cluster",     "mgmtIpAssignment",      null,   "D105", "IP Assignment",       ["IPv4 Only","IPv6 Only","IPv4 & IPv6"]],
    ["Edge Mgmt IP Allocation (Mgmt)",     "Configure Management Domain", "mgmt-cluster",     "mgmtIpAllocation",      "D105", "D106", "IP Allocation",       ["DHCP","Static"]],
    ["Edge Use Cluster Host Overlay (Mgmt)","Configure Management Domain","mgmt-cluster",     "useClusterHostOverlay", "D109", "D110", "Use the host overlay", ["Selected","Unselected"]],
    ["Edge TEP IP Address Type (Mgmt)",    "Configure Management Domain", "mgmt-cluster",     "tepIpAddressType",      null,   "D117", "TEP IP Address Type", ["IPv4","IPv6"]],
    ["Edge TEP IP Allocation (Mgmt)",      "Configure Management Domain", "mgmt-cluster",     "tepIpAllocation",       "D116", "D118", "IP Allocation (TEP)", ["Static IP List","DHCP","IP Pool"]],
    // Configure Workload Domain
    ["Edge Host Group Affinity (WLD)",     "Configure Workload Domain",   "workload-cluster", "hostGroupAffinity",     "D45",  "D45",  "Host Group Affinity", ["Yes","No"]],
    ["Edge Mgmt IP Assignment (WLD)",      "Configure Workload Domain",   "workload-cluster", "mgmtIpAssignment",      null,   "D48",  "IP Assignment",       ["IPv4 Only","IPv6 Only","IPv4 & IPv6"]],
    ["Edge Mgmt IP Allocation (WLD)",      "Configure Workload Domain",   "workload-cluster", "mgmtIpAllocation",      "D48",  "D49",  "IP Allocation",       ["DHCP","Static"]],
    ["Edge Use Cluster Host Overlay (WLD)","Configure Workload Domain",   "workload-cluster", "useClusterHostOverlay", "D52",  "D53",  "Use the host overlay", ["Selected","Unselected"]],
    ["Edge TEP IP Address Type (WLD)",     "Configure Workload Domain",   "workload-cluster", "tepIpAddressType",      null,   "D60",  "TEP IP Address Type", ["IPv4","IPv6"]],
    ["Edge TEP IP Allocation (WLD)",       "Configure Workload Domain",   "workload-cluster", "tepIpAllocation",       "D59",  "D61",  "IP Allocation (TEP)", ["DHCP","IP Pool","Static IP List"]],
  ];

  it.each(ROWS)("%s", (label, sheet, scope, field, c90, c91, verifyLabel, dv) => {
    const e = entryByLabel(label);
    expect(e, `entry '${label}' must exist`).toBeTruthy();
    expect(e.sheet).toBe(sheet);
    expect(e.scope).toBe(scope);
    expect(e.verifyLabel).toBe(verifyLabel);
    expect(e.dataValidation).toEqual(dv);
    expect(cellFor(e, "9.1")).toBe(c91);
    if (c90 === null) {
      expect(e.workbookVersions).toEqual(["9.1"]);
    } else {
      expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
      expect(cellFor(e, "9.0")).toBe(c90);
    }
    // round-trip through cluster.edgeCluster[field]
    const valid = dv[dv.length - 1];
    const cluster = { edgeCluster: { ...createEdgeCluster(), [field]: valid } };
    expect(e.resolve({}, { cluster })).toBe(valid);
    const target = { edgeCluster: createEdgeCluster() };
    e.apply({}, { cluster: target }, valid);
    expect(target.edgeCluster[field]).toBe(valid);
  });

  it("apply coerces an out-of-enum value to the default", () => {
    const e = entryByLabel("Edge TEP IP Allocation (Mgmt)");
    const target = { edgeCluster: createEdgeCluster() };
    e.apply({}, { cluster: target }, "garbage");
    expect(target.edgeCluster.tepIpAllocation).toBe("DHCP"); // default
  });
});

describe("edge overlay-pool cell-map entries (PR-2)", () => {
  it("createEdgeCluster carries the 3 overlay-pool fields (empty strings)", () => {
    const ec = createEdgeCluster();
    expect(ec.ipPoolName).toBe("");
    expect(ec.overlayPoolStart).toBe("");
    expect(ec.overlayPoolEnd).toBe("");
  });

  // [label, sheet, scope, field, cell90, cell91, verifyLabel]
  const ROWS = [
    ["Edge IP Pool Name (Mgmt)",          "Configure Management Domain", "mgmt-cluster",     "ipPoolName",       "D117", "D119", "IP Pool"],
    ["Edge Overlay Pool Start (Mgmt)",    "Configure Management Domain", "mgmt-cluster",     "overlayPoolStart", "D118", "D120", "Edge Overlay Pool: Start IP"],
    ["Edge Overlay Pool End (Mgmt)",      "Configure Management Domain", "mgmt-cluster",     "overlayPoolEnd",   "D119", "D121", "Edge Overlay Pool: End IP"],
    ["Edge IP Pool Name (WLD)",           "Configure Workload Domain",   "workload-cluster", "ipPoolName",       "D60",  "D62",  "IP Pool"],
    ["Edge Overlay Pool Start (WLD)",     "Configure Workload Domain",   "workload-cluster", "overlayPoolStart", "D61",  "D63",  "Edge Overlay Pool: Start IP"],
    ["Edge Overlay Pool End (WLD)",       "Configure Workload Domain",   "workload-cluster", "overlayPoolEnd",   "D62",  "D64",  "Edge Overlay Pool: End IP"],
  ];

  it.each(ROWS)("%s", (label, sheet, scope, field, c90, c91, verifyLabel) => {
    const e = entryByLabel(label);
    expect(e, `entry '${label}' must exist`).toBeTruthy();
    expect(e.sheet).toBe(sheet);
    expect(e.scope).toBe(scope);
    expect(e.verifyLabel).toBe(verifyLabel);
    expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
    expect(cellFor(e, "9.0")).toBe(c90);
    expect(cellFor(e, "9.1")).toBe(c91);
    expect(e.dataValidation).toBeUndefined(); // plain text, no dropdown
    const cluster = { edgeCluster: { ...createEdgeCluster(), [field]: "10.50.0.10" } };
    expect(e.resolve({}, { cluster })).toBe("10.50.0.10");
    const target = { edgeCluster: createEdgeCluster() };
    e.apply({}, { cluster: target }, "10.50.0.20");
    expect(target.edgeCluster[field]).toBe("10.50.0.20");
  });
});

describe("edge static-IP-list cell-map entries (completion)", () => {
  it("createEdgeCluster carries the 3 static-list fields (empty strings)", () => {
    const ec = createEdgeCluster();
    expect(ec.tepStaticCidr).toBe("");
    expect(ec.tepStaticGateway).toBe("");
    expect(ec.tepStaticSubnetMask).toBe("");
  });

  // [label, sheet, scope, field, cell90|null, cell91, verifyLabel]
  const ROWS = [
    ["Edge Static IPv4 Gateway (Mgmt)",  "Configure Management Domain", "mgmt-cluster",     "tepStaticGateway",    "D122", "D125", "Static IPv4 Gateway"],
    ["Edge Static IPv4 Subnet Mask (Mgmt)","Configure Management Domain","mgmt-cluster",     "tepStaticSubnetMask", "D123", "D126", "IPv4 Subnet Mask"],
    ["Edge Static IP List CIDR (Mgmt)",  "Configure Management Domain", "mgmt-cluster",     "tepStaticCidr",       null,   "D124", "CIDR"],
    ["Edge Static IPv4 Gateway (WLD)",   "Configure Workload Domain",   "workload-cluster", "tepStaticGateway",    "D65",  "D68",  "Static IPv4 Gateway"],
    ["Edge Static IPv4 Subnet Mask (WLD)","Configure Workload Domain",  "workload-cluster", "tepStaticSubnetMask", "D66",  "D69",  "IPv4 Subnet Mask"],
    ["Edge Static IP List CIDR (WLD)",   "Configure Workload Domain",   "workload-cluster", "tepStaticCidr",       null,   "D67",  "CIDR"],
  ];

  it.each(ROWS)("%s", (label, sheet, scope, field, c90, c91, verifyLabel) => {
    const e = entryByLabel(label);
    expect(e, `entry '${label}' must exist`).toBeTruthy();
    expect(e.sheet).toBe(sheet);
    expect(e.scope).toBe(scope);
    expect(e.verifyLabel).toBe(verifyLabel);
    expect(e.dataValidation).toBeUndefined();
    expect(cellFor(e, "9.1")).toBe(c91);
    if (c90 === null) {
      expect(e.workbookVersions).toEqual(["9.1"]);
    } else {
      expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
      expect(cellFor(e, "9.0")).toBe(c90);
    }
    const cluster = { edgeCluster: { ...createEdgeCluster(), [field]: "10.60.0.1" } };
    expect(e.resolve({}, { cluster })).toBe("10.60.0.1");
    const target = { edgeCluster: createEdgeCluster() };
    e.apply({}, { cluster: target }, "255.255.255.0");
    expect(target.edgeCluster[field]).toBe("255.255.255.0");
  });

  it("createEdgeCluster carries formFactor + deployEdgesUsingApi defaults", () => {
    const ec = createEdgeCluster();
    expect(ec.formFactor).toBe("Medium");
    expect(ec.deployEdgesUsingApi).toBe("Include");
  });

  // [label, sheet, scope, field, cell90|null, cell91, verifyLabel, dv]
  const TAIL = [
    ["Edge Form Factor (Mgmt)",          "Configure Management Domain", "mgmt-cluster",     "formFactor",          null,   "D206", "Form Factor",            ["Small","Medium","Large","Extra Large"]],
    ["Edge Form Factor (WLD)",           "Configure Workload Domain",   "workload-cluster", "formFactor",          null,   "D149", "Form Factor",            ["Small","Medium","Large","Extra Large"]],
    ["Edge Deploy Edges Using API (Mgmt)","Configure Management Domain","mgmt-cluster",      "deployEdgesUsingApi", "D191", "D228", "Deploy Edges Using API", ["Include","Exclude"]],
    ["Edge Deploy Edges Using API (WLD)", "Configure Workload Domain",  "workload-cluster", "deployEdgesUsingApi", "D134", "D174", "Deploy Edges Using API", ["Include","Exclude"]],
  ];
  it.each(TAIL)("%s", (label, sheet, scope, field, c90, c91, verifyLabel, dv) => {
    const e = entryByLabel(label);
    expect(e, `entry '${label}' must exist`).toBeTruthy();
    expect(e.sheet).toBe(sheet);
    expect(e.scope).toBe(scope);
    expect(e.verifyLabel).toBe(verifyLabel);
    expect(e.dataValidation).toEqual(dv);
    expect(cellFor(e, "9.1")).toBe(c91);
    if (c90 === null) { expect(e.workbookVersions).toEqual(["9.1"]); }
    else { expect(e.workbookVersions).toEqual(["9.0", "9.1"]); expect(cellFor(e, "9.0")).toBe(c90); }
    const valid = dv[dv.length - 1];
    const cluster = { edgeCluster: { ...createEdgeCluster(), [field]: valid } };
    expect(e.resolve({}, { cluster })).toBe(valid);
    const target = { edgeCluster: createEdgeCluster() };
    e.apply({}, { cluster: target }, valid);
    expect(target.edgeCluster[field]).toBe(valid);
  });

  it("does NOT map the Management Gateway (it is a workbook formula cell)", () => {
    // "Edge Node N: Management Gateway" is dataType [f] in the fixtures — a
    // derived formula, not a stampable input. No cell-map entry should target it.
    const gwEntries = WORKBOOK_CELL_MAP.filter(
      (m) => /Management Domain|Workload Domain/.test(m.sheet) &&
             /Management Gateway/i.test(m.verifyLabel || "")
    );
    expect(gwEntries).toEqual([]);
  });
});
