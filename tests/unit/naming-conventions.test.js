import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  slugify,
  resolveTemplate,
  mergeNamingConfig,
  hostTokensFor,
  vdsTokensFor,
  vdsSlotPurpose,
  resolveHostname,
  resolveVdsName,
  applyVdsTemplate,
  validateHostnameFormat,
  validateNamingDesign,
  validateNetworkDesign,
  createFleetNamingConfig,
  createClusterNaming,
  newFleet,
  newSite,
  newInstance,
  newWorkloadDomain,
  newWorkloadCluster,
  migrateFleet,
  emitInstallerJson,
  emitWorkbookRows,
  sizeFleet,
  NIC_PROFILES,
} = VcfEngine;

// ─────────────────────────────────────────────────────────────────────────────
// Plan 7 — Naming Conventions
//
// Token-based templates for hosts and vDS switches. Templates live at
// fleet level with optional cluster overrides; per-host literals beat
// templates. Validators flag uniqueness collisions and DNS-format errors.
// ─────────────────────────────────────────────────────────────────────────────

describe("slugify", () => {
  it("lowercases and replaces spaces with separator", () => {
    expect(slugify("Production WLD")).toBe("production-wld");
  });

  it("collapses runs of separator", () => {
    expect(slugify("a   b__c")).toBe("a-b-c");
  });

  it("strips non-alphanumeric (keeps separator)", () => {
    expect(slugify("WH200/Site #1!")).toBe("wh200site-1");
  });

  it("trims leading and trailing separators", () => {
    expect(slugify("---hello---")).toBe("hello");
  });

  it("respects custom separator", () => {
    expect(slugify("Production WLD", "_")).toBe("production_wld");
  });

  it("caps at maxLen and trims trailing separator after cap", () => {
    expect(slugify("a-b-c-d-e-f-g-h-i-j-k-l", "-", 7)).toBe("a-b-c-d");
  });

  it("returns empty string for null / undefined / empty input", () => {
    expect(slugify(null)).toBe("");
    expect(slugify(undefined)).toBe("");
    expect(slugify("")).toBe("");
  });

  it("returns empty string when input has no usable chars after stripping", () => {
    expect(slugify("!!!@@@")).toBe("");
  });
});

describe("resolveTemplate", () => {
  it("substitutes a single token", () => {
    expect(resolveTemplate("{name}", { name: "esx" })).toBe("esx");
  });

  it("substitutes multiple tokens with separator", () => {
    expect(resolveTemplate("{a}-{b}-{c}", { a: "vcf", b: "wh200", c: "wld" })).toBe("vcf-wh200-wld");
  });

  it("zero-pads numeric tokens with :NN syntax", () => {
    expect(resolveTemplate("host-{seq:02}", { seq: 1 })).toBe("host-01");
    expect(resolveTemplate("host-{seq:03}", { seq: 7 })).toBe("host-007");
    expect(resolveTemplate("host-{seq:02}", { seq: 99 })).toBe("host-99");
  });

  it("renders bare {seq} without padding when value is a number", () => {
    expect(resolveTemplate("host-{seq}", { seq: 5 })).toBe("host-5");
  });

  it("drops unknown tokens", () => {
    expect(resolveTemplate("{prefix}-{unknown}-{suffix}", { prefix: "vcf", suffix: "lab" })).toBe("vcf-lab");
  });

  it("collapses runs of separator after empty-token substitution", () => {
    expect(resolveTemplate("{a}-{empty}-{b}", { a: "x", b: "y", empty: "" })).toBe("x-y");
  });

  it("preserves leading dot in substituted token (FQDN postfix)", () => {
    expect(resolveTemplate("{prefix}-{seq:02}{postfix}", { prefix: "vcf", seq: 1, postfix: ".lab.local" }))
      .toBe("vcf-01.lab.local");
  });

  it("returns empty string for empty template", () => {
    expect(resolveTemplate("", { a: "x" })).toBe("");
    expect(resolveTemplate(null, { a: "x" })).toBe("");
  });
});

describe("mergeNamingConfig", () => {
  it("falls back to fleet defaults when cluster overrides are null", () => {
    const merged = mergeNamingConfig(
      { hostTemplate: "fleet", vdsTemplate: "vds", prefix: "vcf", postfix: ".lab", separator: "-", seqStart: 1, seqPadding: 2 },
      { hostTemplate: null, vdsTemplate: null, prefix: null, postfix: null }
    );
    expect(merged.hostTemplate).toBe("fleet");
    expect(merged.prefix).toBe("vcf");
    expect(merged.postfix).toBe(".lab");
  });

  it("cluster overrides win over fleet defaults", () => {
    const merged = mergeNamingConfig(
      { hostTemplate: "fleet", prefix: "vcf", separator: "-", seqStart: 1, seqPadding: 2 },
      { hostTemplate: "cluster-specific", prefix: "override" }
    );
    expect(merged.hostTemplate).toBe("cluster-specific");
    expect(merged.prefix).toBe("override");
  });

  it("returns sane defaults when both inputs are null", () => {
    const merged = mergeNamingConfig(null, null);
    expect(merged.separator).toBe("-");
    expect(merged.seqStart).toBe(1);
    expect(merged.seqPadding).toBe(2);
  });
});

describe("hostTokensFor", () => {
  it("includes prefix, postfix, instance/cluster slugs, role, and seq", () => {
    const fleet = newFleet();
    const inst = fleet.instances[0];
    const dom = inst.domains.find((d) => d.type === "mgmt");
    const cl = dom.clusters[0];
    const cfg = createFleetNamingConfig();
    cfg.prefix = "vcf";
    cfg.postfix = ".lab.local";
    cfg.seqStart = 1;
    const tokens = hostTokensFor(fleet, inst, dom, cl, 0, cfg);
    expect(tokens.prefix).toBe("vcf");
    expect(tokens.postfix).toBe(".lab.local");
    expect(tokens.instance).toBe("vcf-instance-01");
    expect(tokens.cluster).toBe("mgmt-cluster-01");
    expect(tokens.role).toBe("mgmt");
    expect(tokens.seq).toBe(1);
  });

  it("seq advances with hostIndex by seqStart offset", () => {
    const fleet = newFleet();
    const inst = fleet.instances[0];
    const dom = inst.domains[0];
    const cl = dom.clusters[0];
    const cfg = createFleetNamingConfig();
    cfg.seqStart = 10;
    expect(hostTokensFor(fleet, inst, dom, cl, 0, cfg).seq).toBe(10);
    expect(hostTokensFor(fleet, inst, dom, cl, 4, cfg).seq).toBe(14);
  });
});

describe("vdsSlotPurpose", () => {
  it("derives mgmt-vmotion when those portgroups share a vDS in 4-nic profile", () => {
    const cl = newWorkloadCluster();
    cl.networks.nicProfileId = "4-nic";
    cl.networks.vds = NIC_PROFILES["4-nic"].vds.map((v) => ({ ...v }));
    expect(vdsSlotPurpose(cl, "vds-mgmt-vmotion").split("-").sort()).toEqual(["mgmt", "vmotion"]);
  });

  it("derives 'converged' for 2-nic single-vDS profile", () => {
    const cl = newWorkloadCluster();
    cl.networks.nicProfileId = "2-nic";
    cl.networks.vds = NIC_PROFILES["2-nic"].vds.map((v) => ({ ...v }));
    const purpose = vdsSlotPurpose(cl, "vds-converged");
    // All four portgroups (mgmt, vmotion, vsan, hostTep) point at vds-converged.
    expect(purpose.split("-").sort()).toEqual(["hosttep", "mgmt", "vmotion", "vsan"]);
  });

  it("returns slug of vDS name when name doesn't match the profile", () => {
    const cl = newWorkloadCluster();
    cl.networks.nicProfileId = "4-nic";
    cl.networks.vds = [{ name: "user-renamed-vds", uplinks: ["vmnic0", "vmnic1"], mtu: 9000 }];
    expect(vdsSlotPurpose(cl, "user-renamed-vds")).toBeTruthy();
  });
});

describe("resolveHostname", () => {
  function buildFleet() {
    const fleet = newFleet();
    fleet.namingConfig.hostTemplate = "{prefix}-{role}-{seq:02}";
    fleet.namingConfig.prefix = "vcf";
    fleet.namingConfig.seqStart = 1;
    return fleet;
  }

  it("returns null when template is empty", () => {
    const fleet = newFleet();
    const inst = fleet.instances[0];
    const dom = inst.domains[0];
    const cl = dom.clusters[0];
    expect(resolveHostname(fleet, inst, dom, cl, 0)).toBeNull();
  });

  it("resolves the template against host context", () => {
    const fleet = buildFleet();
    const inst = fleet.instances[0];
    const dom = inst.domains[0];
    const cl = dom.clusters[0];
    expect(resolveHostname(fleet, inst, dom, cl, 0)).toBe("vcf-mgmt-01");
    expect(resolveHostname(fleet, inst, dom, cl, 4)).toBe("vcf-mgmt-05");
  });

  it("per-host override beats template", () => {
    const fleet = buildFleet();
    const inst = fleet.instances[0];
    const dom = inst.domains[0];
    const cl = dom.clusters[0];
    cl.hostOverrides = [{ hostIndex: 0, hostname: "esx-special.lab.local", mgmtIp: null, vmotionIp: null, vsanIp: null, hostTepIps: null, bmcIp: null }];
    expect(resolveHostname(fleet, inst, dom, cl, 0)).toBe("esx-special.lab.local");
    // Other hosts still use template.
    expect(resolveHostname(fleet, inst, dom, cl, 1)).toBe("vcf-mgmt-02");
  });

  it("cluster-level template overrides fleet template", () => {
    const fleet = buildFleet();
    const inst = fleet.instances[0];
    const dom = inst.domains[0];
    const cl = dom.clusters[0];
    cl.naming = { hostTemplate: "cluster-{seq:03}", vdsTemplate: null, prefix: null, postfix: null };
    expect(resolveHostname(fleet, inst, dom, cl, 0)).toBe("cluster-001");
  });

  it("workload domain resolves role=wld", () => {
    const fleet = buildFleet();
    const inst = fleet.instances[0];
    const wld = newWorkloadDomain("WLD");
    inst.domains.push(wld);
    expect(resolveHostname(fleet, inst, wld, wld.clusters[0], 0)).toBe("vcf-wld-01");
  });
});

describe("resolveVdsName + applyVdsTemplate", () => {
  it("returns null when vDS template is empty", () => {
    const fleet = newFleet();
    const inst = fleet.instances[0];
    const dom = inst.domains[0];
    const cl = dom.clusters[0];
    expect(resolveVdsName(fleet, inst, dom, cl, 0)).toBeNull();
  });

  it("resolves vDS name with {purpose} token", () => {
    const fleet = newFleet();
    fleet.namingConfig.vdsTemplate = "{prefix}-{cluster}-vds-{purpose}";
    fleet.namingConfig.prefix = "vcf";
    const inst = fleet.instances[0];
    const dom = inst.domains[0];
    const cl = dom.clusters[0];
    cl.networks.nicProfileId = "4-nic";
    cl.networks.vds = NIC_PROFILES["4-nic"].vds.map((v) => ({ ...v }));
    const resolved = resolveVdsName(fleet, inst, dom, cl, 0);
    expect(resolved).toMatch(/^vcf-mgmt-cluster-01-vds-/);
  });

  it("applyVdsTemplate writes resolved names into a new cluster object", () => {
    const fleet = newFleet();
    fleet.namingConfig.vdsTemplate = "vds-{purpose}";
    const inst = fleet.instances[0];
    const dom = inst.domains[0];
    const cl = dom.clusters[0];
    cl.networks.nicProfileId = "4-nic";
    cl.networks.vds = NIC_PROFILES["4-nic"].vds.map((v) => ({ ...v }));
    const next = applyVdsTemplate(fleet, inst, dom, cl);
    expect(next.networks.vds).toHaveLength(cl.networks.vds.length);
    next.networks.vds.forEach((slot) => {
      expect(slot.name).toMatch(/^vds-/);
    });
    // Original is untouched.
    expect(cl.networks.vds[0].name).toBe(NIC_PROFILES["4-nic"].vds[0].name);
  });

  it("applyVdsTemplate is a no-op when the fleet template is empty", () => {
    const fleet = newFleet();
    const inst = fleet.instances[0];
    const dom = inst.domains[0];
    const cl = dom.clusters[0];
    const next = applyVdsTemplate(fleet, inst, dom, cl);
    expect(next).toBe(cl);
  });
});

describe("validateHostnameFormat", () => {
  it("accepts valid lowercase DNS hostnames", () => {
    expect(validateHostnameFormat("esx-01")).toBeNull();
    expect(validateHostnameFormat("vcf-wh200-mgmt-01.lab.local")).toBeNull();
    expect(validateHostnameFormat("a")).toBeNull();
  });

  it("rejects labels longer than 63 chars", () => {
    const longLabel = "a".repeat(64);
    expect(validateHostnameFormat(longLabel)).toMatch(/exceeds 63 chars/);
  });

  it("rejects total FQDN longer than 253 chars", () => {
    const big = ("a".repeat(50) + ".").repeat(6) + "abc";
    expect(big.length).toBeGreaterThan(253);
    expect(validateHostnameFormat(big)).toMatch(/253-char FQDN limit/);
  });

  it("rejects invalid characters", () => {
    expect(validateHostnameFormat("ESX_01")).toMatch(/invalid chars/);
    expect(validateHostnameFormat("esx 01")).toMatch(/invalid chars/);
    expect(validateHostnameFormat("esx@01")).toMatch(/invalid chars/);
  });

  it("rejects leading or trailing hyphen on a label", () => {
    expect(validateHostnameFormat("-esx01")).toMatch(/invalid chars/);
    expect(validateHostnameFormat("esx01-")).toMatch(/invalid chars/);
    expect(validateHostnameFormat("ok.-bad.tld")).toMatch(/invalid chars/);
  });

  it("returns null for null / empty input", () => {
    expect(validateHostnameFormat(null)).toBeNull();
    expect(validateHostnameFormat("")).toBeNull();
  });
});

describe("validateNamingDesign", () => {
  function fleetWithTemplate(hostTemplate) {
    const fleet = newFleet();
    fleet.namingConfig.hostTemplate = hostTemplate;
    fleet.namingConfig.prefix = "vcf";
    return fleet;
  }

  it("returns no issues when no template is configured", () => {
    const fleet = newFleet();
    const fr = sizeFleet(fleet);
    expect(validateNamingDesign(fleet, fr)).toEqual([]);
  });

  it("flags VCF-NAMING-001 when two clusters resolve to the same hostname", () => {
    // Template without {cluster}, {site} → mgmt + wld in same instance collide.
    const fleet = fleetWithTemplate("{prefix}-{role}-{seq:02}");
    const wld = newWorkloadDomain("WLD");
    fleet.instances[0].domains.push(wld);
    // Force {role} collision by giving both domains type=mgmt is impossible,
    // but a template without role still collides between the two domains.
    fleet.namingConfig.hostTemplate = "{prefix}-{seq:02}";
    const fr = sizeFleet(fleet);
    const issues = validateNamingDesign(fleet, fr);
    const collisions = issues.filter((i) => i.ruleId === "VCF-NAMING-001");
    expect(collisions.length).toBeGreaterThan(0);
  });

  it("flags VCF-NAMING-002 when resolved hostname has invalid chars", () => {
    // Force an underscore into the resolved name via prefix.
    const fleet = fleetWithTemplate("{prefix}_host_{seq:02}");
    const fr = sizeFleet(fleet);
    const issues = validateNamingDesign(fleet, fr);
    const formatIssues = issues.filter((i) => i.ruleId === "VCF-NAMING-002");
    expect(formatIssues.length).toBeGreaterThan(0);
    expect(formatIssues[0].message).toMatch(/invalid chars/);
  });

  it("does not fire on flexible / wld-only appliances or when uniqueness holds", () => {
    const fleet = fleetWithTemplate("{prefix}-{instance}-{cluster}-{role}-{seq:02}");
    const wld = newWorkloadDomain("WLD");
    fleet.instances[0].domains.push(wld);
    const fr = sizeFleet(fleet);
    expect(validateNamingDesign(fleet, fr)).toEqual([]);
  });

  it("validateNetworkDesign also surfaces naming issues when fleetResult is provided", () => {
    const fleet = fleetWithTemplate("{prefix}_{seq}");
    const fr = sizeFleet(fleet);
    const issues = validateNetworkDesign(fleet, fr);
    const namingIssues = issues.filter((i) => i.ruleId.startsWith("VCF-NAMING-"));
    expect(namingIssues.length).toBeGreaterThan(0);
  });

  it("validateNetworkDesign without fleetResult skips per-host naming checks gracefully", () => {
    const fleet = fleetWithTemplate("{prefix}_{seq}");
    // No fleetResult → finalHosts unknown → falls back to hostOverrides count
    // (zero in this fleet) → no naming issues raised.
    const issues = validateNetworkDesign(fleet);
    const namingIssues = issues.filter((i) => i.ruleId.startsWith("VCF-NAMING-"));
    expect(namingIssues).toEqual([]);
  });
});

describe("Migration backfill (Plan 7)", () => {
  it("adds namingConfig with empty defaults to fleets that lack it", () => {
    const legacy = { version: "vcf-sizer-v9", instances: [] };
    const m = migrateFleet(legacy);
    expect(m.namingConfig).toBeDefined();
    expect(m.namingConfig.hostTemplate).toBe("");
    expect(m.namingConfig.vdsTemplate).toBe("");
    expect(m.namingConfig.separator).toBe("-");
  });

  it("preserves an explicit namingConfig on round-trip", () => {
    const fleet = newFleet();
    fleet.namingConfig.hostTemplate = "vcf-{seq:02}";
    fleet.namingConfig.prefix = "lab";
    const once = migrateFleet({ version: "vcf-sizer-v9", fleet });
    expect(once.namingConfig.hostTemplate).toBe("vcf-{seq:02}");
    expect(once.namingConfig.prefix).toBe("lab");
    const twice = migrateFleet({ version: "vcf-sizer-v9", fleet: once });
    expect(JSON.stringify(twice.namingConfig)).toBe(JSON.stringify(once.namingConfig));
  });

  it("backfills cluster.naming on existing clusters", () => {
    const legacy = {
      version: "vcf-sizer-v9",
      instances: [{
        id: "i1",
        siteIds: ["s1"],
        domains: [{
          id: "d1", type: "mgmt", placement: "local",
          clusters: [{ id: "c1", networks: {}, hostOverrides: [] }],
        }],
      }],
    };
    const m = migrateFleet(legacy);
    expect(m.instances[0].domains[0].clusters[0].naming).toBeDefined();
    expect(m.instances[0].domains[0].clusters[0].naming.hostTemplate).toBeNull();
  });

  it("backfills hostname:null on existing hostOverrides without overwriting", () => {
    const legacy = {
      version: "vcf-sizer-v9",
      instances: [{
        id: "i1",
        siteIds: ["s1"],
        domains: [{
          id: "d1", type: "mgmt", placement: "local",
          clusters: [{
            id: "c1",
            networks: {},
            hostOverrides: [
              { hostIndex: 0, mgmtIp: "10.0.0.10", hostname: "preserved" },
              { hostIndex: 1, mgmtIp: "10.0.0.11" },
            ],
          }],
        }],
      }],
    };
    const m = migrateFleet(legacy);
    const overrides = m.instances[0].domains[0].clusters[0].hostOverrides;
    expect(overrides[0].hostname).toBe("preserved");
    expect(overrides[1].hostname).toBeNull();
  });
});

describe("Export integration (Plan 7)", () => {
  function fleetWithHosts() {
    const fleet = newFleet();
    fleet.namingConfig.hostTemplate = "{prefix}-{role}-{seq:02}{postfix}";
    fleet.namingConfig.prefix = "vcf";
    fleet.namingConfig.postfix = ".lab.local";
    // Populate mgmt subnet/pool so allocateClusterIps yields hosts.
    const cl = fleet.instances[0].domains[0].clusters[0];
    cl.networks.mgmt = {
      vlan: 100,
      subnet: "10.0.0.0/24",
      gateway: "10.0.0.1",
      pool: { start: "10.0.0.10", end: "10.0.0.50" },
    };
    return fleet;
  }

  it("emitInstallerJson populates hostSpecs[].hostname when template is set", () => {
    const fleet = fleetWithHosts();
    const fr = sizeFleet(fleet);
    const out = emitInstallerJson(fleet, fr);
    expect(out.hostSpecs.length).toBeGreaterThan(0);
    const first = out.hostSpecs[0];
    expect(first.hostname).toBe("vcf-mgmt-01.lab.local");
  });

  it("emitWorkbookRows includes a Hostname column", () => {
    const fleet = fleetWithHosts();
    const fr = sizeFleet(fleet);
    const sheets = emitWorkbookRows(fleet, fr);
    const ipPlanSheet = sheets.find((s) => s.sheet === "IP Address Plan");
    expect(ipPlanSheet.rows[0]).toContain("Hostname");
    // First data row's hostname column matches the template.
    const hostnameIdx = ipPlanSheet.rows[0].indexOf("Hostname");
    expect(ipPlanSheet.rows[1][hostnameIdx]).toBe("vcf-mgmt-01.lab.local");
  });

  it("with empty template, exports emit empty/null hostname (legacy behavior preserved)", () => {
    const fleet = newFleet();
    const cl = fleet.instances[0].domains[0].clusters[0];
    cl.networks.mgmt = {
      vlan: 100,
      subnet: "10.0.0.0/24",
      gateway: "10.0.0.1",
      pool: { start: "10.0.0.10", end: "10.0.0.50" },
    };
    const fr = sizeFleet(fleet);
    const out = emitInstallerJson(fleet, fr);
    expect(out.hostSpecs.every((h) => h.hostname === null)).toBe(true);
  });
});
