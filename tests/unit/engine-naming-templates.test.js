// engine.js Phase B — naming-template engine behavior coverage.
// Targets the hostname/FQDN/VDS-slot generators that produce every
// name in an exported workbook. A regression here silently breaks
// names; these tests are the safety net.
//
// NOTE: engine-naming-templates.test.js is additive to the existing
// naming-conventions.test.js which already covers the happy-path for
// all these functions. This file targets edge-case branches and code
// paths that aren't hit by the older file:
//   - vdsTokensFor called directly (imported but never invoked directly)
//   - hostTokensFor stretched-domain site-resolution (stretchSiteIds branch)
//   - hostTokensFor instance.siteIds fallback path
//   - hostTokensFor + vdsTokensFor null-guard defensive paths
//   - resolveTemplate with a custom separator
//   - resolveTemplate pad syntax on a string value (no zero-padding applied)
//   - mergeNamingConfig seqStart / seqPadding type-guard branches
//   - vdsSlotPurpose when cluster has no networks (returns "")
//   - vdsSlotPurpose when VDS name doesn't match profile by name, falls back to slot index
//   - applyVdsTemplate preserveCustom: true preserves user-renamed VDS slot
//   - validateHostnameFormat empty non-terminal label (two consecutive dots mid-name)
//   - validateNamingDesign with a real fleetResult (clusterResults path)

import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  resolveTemplate,
  mergeNamingConfig,
  hostTokensFor,
  vdsTokensFor,
  vdsSlotPurpose,
  resolveHostname,
  applyVdsTemplate,
  validateHostnameFormat,
  validateNamingDesign,
  createFleetNamingConfig,
  createClusterNaming,
  newFleet,
  newSite,
  newInstance,
  newWorkloadDomain,
  newWorkloadCluster,
  NIC_PROFILES,
  sizeFleet,
} = VcfEngine;

// ─────────────────────────────────────────────────────────────────────────────
// resolveTemplate — edge cases not covered by naming-conventions.test.js
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveTemplate — edge cases", () => {
  it("uses '.' as a custom separator without double-collapsing FQDN dots", () => {
    // separator = "." means the collapse regex becomes \.\. → collapse runs of dots
    const result = resolveTemplate("{prefix}.{seq}", { prefix: "esx", seq: 1 }, ".");
    expect(result).toBe("esx.1");
  });

  it("does not zero-pad a string token even when :NN pad syntax is present", () => {
    // pad only applies when typeof v === "number". A string "01" is NOT padded.
    expect(resolveTemplate("host-{seq:03}", { seq: "01" })).toBe("host-01");
  });

  it("handles a token map with explicit undefined values (renders as empty, trailing sep kept)", () => {
    // undefined is == null so the replacement returns "" not "undefined".
    // The function only strips the LEADING separator, not trailing — so "x-" is the result.
    const result = resolveTemplate("{a}-{b}", { a: "x", b: undefined });
    expect(result).toBe("x-");
  });

  it("collapses triple-separator runs created by two adjacent empty-token substitutions", () => {
    // {b} and {c} are unknown → empty → {a}---{d} collapses to {a}-{d}
    const result = resolveTemplate("{a}-{b}-{c}-{d}", { a: "start", d: "end" });
    expect(result).toBe("start-end");
  });

  it("leaves a template with no {token} markers unchanged", () => {
    expect(resolveTemplate("static-name", {})).toBe("static-name");
    expect(resolveTemplate("static-name", { anything: "ignored" })).toBe("static-name");
  });

  it("zero-pads when token value is a number and pad width is given", () => {
    expect(resolveTemplate("{seq:04}", { seq: 3 })).toBe("0003");
  });

  it("does not strip a trailing hyphen that appears at the END of a resolved string", () => {
    // resolveTemplate only trims the LEADING separator, not trailing.
    // Template "host-{suffix}" with suffix="" → "host-" (trailing hyphen kept).
    const result = resolveTemplate("host-{suffix}", { suffix: "" });
    expect(result).toBe("host-");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeNamingConfig — type-guard branches
// ─────────────────────────────────────────────────────────────────────────────

describe("mergeNamingConfig — type-guard branches", () => {
  it("falls back to seqStart=1 when fleet seqStart is not a number", () => {
    const merged = mergeNamingConfig(
      { hostTemplate: "", vdsTemplate: "", prefix: "", postfix: "", separator: "-", seqStart: "ten", seqPadding: 2 },
      null
    );
    expect(merged.seqStart).toBe(1);
  });

  it("falls back to seqPadding=2 when fleet seqPadding is not a number", () => {
    const merged = mergeNamingConfig(
      { hostTemplate: "", vdsTemplate: "", prefix: "", postfix: "", separator: "-", seqStart: 1, seqPadding: "two" },
      null
    );
    expect(merged.seqPadding).toBe(2);
  });

  it("falls back to separator='-' when fleet separator is empty string", () => {
    const merged = mergeNamingConfig(
      { hostTemplate: "", vdsTemplate: "", prefix: "", postfix: "", separator: "", seqStart: 1, seqPadding: 2 },
      null
    );
    expect(merged.separator).toBe("-");
  });

  it("cluster empty-string hostTemplate beats fleet non-empty hostTemplate", () => {
    // "" is not null/undefined — the cluster value wins (even if it's an empty string).
    const merged = mergeNamingConfig(
      { hostTemplate: "fleet-tpl", vdsTemplate: "", prefix: "", postfix: "", separator: "-", seqStart: 1, seqPadding: 2 },
      { hostTemplate: "", vdsTemplate: null, prefix: null, postfix: null }
    );
    expect(merged.hostTemplate).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hostTokensFor — site-resolution fallback chain
// ─────────────────────────────────────────────────────────────────────────────

describe("hostTokensFor — site-resolution fallback chain", () => {
  it("resolves site from domain.stretchSiteIds[0] when domain.localSiteId is null", () => {
    const fleet = newFleet();
    const site = fleet.sites[0];
    const inst = fleet.instances[0];
    // Build a fake stretched domain pointing at the fleet's site
    const dom = {
      type: "workload",
      localSiteId: null,
      stretchSiteIds: [site.id, "site-other"],
      clusters: [],
    };
    const cl = { name: "wld-cluster", hostOverrides: [] };
    const cfg = createFleetNamingConfig();
    cfg.seqStart = 1;
    const tokens = hostTokensFor(fleet, inst, dom, cl, 0, cfg);
    // site.name is "Primary Site" → slugified is "primary-site"
    expect(tokens.site).toBe("primary-site");
    expect(tokens.role).toBe("wld");
  });

  it("resolves site from instance.siteIds[0] when domain has no localSiteId or stretchSiteIds", () => {
    const fleet = newFleet();
    const site = fleet.sites[0];
    const inst = fleet.instances[0];
    // Domain has neither localSiteId nor stretchSiteIds
    const dom = {
      type: "mgmt",
      localSiteId: null,
      stretchSiteIds: null,
      clusters: [],
    };
    // Instance points at the fleet's site
    inst.siteIds = [site.id];
    const cl = { name: "mgmt-cluster", hostOverrides: [] };
    const cfg = createFleetNamingConfig();
    cfg.seqStart = 1;
    const tokens = hostTokensFor(fleet, inst, dom, cl, 0, cfg);
    expect(tokens.site).toBe("primary-site");
    expect(tokens.role).toBe("mgmt");
  });

  it("returns empty site token when fleet has no matching site for any resolved siteId", () => {
    const fleet = newFleet();
    const inst = fleet.instances[0];
    const dom = {
      type: "workload",
      localSiteId: "nonexistent-site-id",
      stretchSiteIds: null,
      clusters: [],
    };
    const cl = { name: "cl", hostOverrides: [] };
    const cfg = createFleetNamingConfig();
    cfg.seqStart = 1;
    const tokens = hostTokensFor(fleet, inst, dom, cl, 0, cfg);
    expect(tokens.site).toBe("");
  });

  it("handles null instance and domain gracefully (defensive nulls)", () => {
    const fleet = newFleet();
    const cfg = createFleetNamingConfig();
    cfg.seqStart = 5;
    const tokens = hostTokensFor(fleet, null, null, null, 2, cfg);
    expect(tokens.site).toBe("");
    expect(tokens.instance).toBe("");
    expect(tokens.cluster).toBe("");
    // domain is null → type check falls to false → "wld"
    expect(tokens.domain).toBe("wld");
    expect(tokens.seq).toBe(7); // seqStart(5) + hostIndex(2)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// vdsTokensFor — direct invocation (not tested in naming-conventions.test.js)
// ─────────────────────────────────────────────────────────────────────────────

describe("vdsTokensFor — direct invocation", () => {
  it("produces the expected token map for a local mgmt domain VDS slot", () => {
    const fleet = newFleet();
    const inst = fleet.instances[0];
    const dom = inst.domains[0]; // mgmt domain
    const cl = dom.clusters[0];
    const cfg = createFleetNamingConfig();
    cfg.prefix = "vcf";
    cfg.postfix = ".lab";
    cfg.seqStart = 1;
    const vdsSlot = { purpose: "mgmt-vmotion" };
    const tokens = vdsTokensFor(fleet, inst, dom, cl, vdsSlot, cfg);
    expect(tokens.prefix).toBe("vcf");
    expect(tokens.postfix).toBe(".lab");
    expect(tokens.purpose).toBe("mgmt-vmotion");
    expect(tokens.role).toBe("mgmt");
    expect(typeof tokens.site).toBe("string");
    expect(typeof tokens.cluster).toBe("string");
  });

  it("returns empty purpose when vdsSlot has no purpose field", () => {
    const fleet = newFleet();
    const inst = fleet.instances[0];
    const dom = inst.domains[0];
    const cl = dom.clusters[0];
    const cfg = createFleetNamingConfig();
    const tokens = vdsTokensFor(fleet, inst, dom, cl, { purpose: "" }, cfg);
    expect(tokens.purpose).toBe("");
  });

  it("returns empty purpose when vdsSlot is null", () => {
    const fleet = newFleet();
    const inst = fleet.instances[0];
    const dom = inst.domains[0];
    const cl = dom.clusters[0];
    const cfg = createFleetNamingConfig();
    const tokens = vdsTokensFor(fleet, inst, dom, cl, null, cfg);
    expect(tokens.purpose).toBe("");
  });

  it("resolves site from stretchSiteIds[0] in the vdsTokensFor path", () => {
    const fleet = newFleet();
    const site = fleet.sites[0];
    const inst = fleet.instances[0];
    const dom = {
      type: "workload",
      localSiteId: null,
      stretchSiteIds: [site.id, "site-other"],
    };
    const cl = { name: "stretched-cl" };
    const cfg = createFleetNamingConfig();
    const tokens = vdsTokensFor(fleet, inst, dom, cl, { purpose: "overlay" }, cfg);
    expect(tokens.site).toBe("primary-site");
    expect(tokens.purpose).toBe("overlay");
    expect(tokens.role).toBe("wld");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// vdsSlotPurpose — defensive and fallback branches
// ─────────────────────────────────────────────────────────────────────────────

describe("vdsSlotPurpose — edge branches", () => {
  it("returns empty string when cluster has no networks", () => {
    const cl = { name: "bare-cluster" }; // no .networks
    expect(vdsSlotPurpose(cl, "vds-something")).toBe("");
  });

  it("returns empty string when cluster.networks is null", () => {
    const cl = { networks: null };
    expect(vdsSlotPurpose(cl, "vds-something")).toBe("");
  });

  it("returns slug of vDS name when profile is not found (unknown nicProfileId)", () => {
    const cl = newWorkloadCluster();
    cl.networks.nicProfileId = "99-nic"; // does not exist in NIC_PROFILES
    const result = vdsSlotPurpose(cl, "vds-custom");
    // slugify("vds-custom") → "vds-custom"
    expect(result).toBe("vds-custom");
  });

  it("falls back to clusterSlotIdx when profile slot name doesn't match cluster slot name", () => {
    // The 4-nic profile has vds[0].name = "vds-mgmt-vmotion".
    // If the cluster stores a user-renamed VDS at slot 0, we match by slot index.
    const cl = newWorkloadCluster();
    cl.networks.nicProfileId = "4-nic";
    // Copy the profile VDS list but rename slot 0 to something different.
    cl.networks.vds = NIC_PROFILES["4-nic"].vds.map((v) => ({ ...v }));
    cl.networks.vds[0] = { ...cl.networks.vds[0], name: "user-renamed-slot0" };
    // Ask for the purpose of "user-renamed-slot0" — profile doesn't have this name,
    // so falls back to clusterSlotIdx=0 → profileSlotIdx=0 → portgroups for slot 0.
    const result = vdsSlotPurpose(cl, "user-renamed-slot0");
    // Profile slot 0 hosts mgmt + vmotion for 4-nic
    expect(result).toBeTruthy();
    expect(result.split("-").sort()).toEqual(["mgmt", "vmotion"]);
  });

  it("returns slug of vDS name when cluster has no matching slot at all", () => {
    const cl = newWorkloadCluster();
    cl.networks.nicProfileId = "4-nic";
    cl.networks.vds = NIC_PROFILES["4-nic"].vds.map((v) => ({ ...v }));
    // Ask for a VDS name that doesn't exist anywhere in the cluster VDS list.
    const result = vdsSlotPurpose(cl, "totally-unknown-vds");
    expect(result).toBe("totally-unknown-vds");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveHostname — null-guard defensive path
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveHostname — defensive null cluster", () => {
  it("returns null when cluster is null (no template, no overrides)", () => {
    const fleet = newFleet();
    const inst = fleet.instances[0];
    const dom = inst.domains[0];
    // null cluster → mergeNamingConfig(fleet.namingConfig, null) → empty hostTemplate
    const result = resolveHostname(fleet, inst, dom, null, 0);
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyVdsTemplate — preserveCustom: true path
// ─────────────────────────────────────────────────────────────────────────────

describe("applyVdsTemplate — preserveCustom option", () => {
  it("preserves a user-renamed slot when preserveCustom is true and name differs from profile default", () => {
    const fleet = newFleet();
    fleet.namingConfig.vdsTemplate = "vds-{purpose}";
    const inst = fleet.instances[0];
    const dom = inst.domains[0];
    const cl = dom.clusters[0];
    cl.networks.nicProfileId = "4-nic";
    // Copy profile VDS names, then rename slot 0 to simulate a user override.
    cl.networks.vds = NIC_PROFILES["4-nic"].vds.map((v) => ({ ...v }));
    cl.networks.vds[0] = { ...cl.networks.vds[0], name: "my-custom-vds" };
    const next = applyVdsTemplate(fleet, inst, dom, cl, { preserveCustom: true });
    // Slot 0 has a custom name (differs from profile "vds-mgmt-vmotion") → preserved.
    expect(next.networks.vds[0].name).toBe("my-custom-vds");
    // Slot 1 name matches profile default ("vds-sdn") → gets template-resolved.
    expect(next.networks.vds[1].name).not.toBe("vds-sdn");
  });

  it("applies the template to ALL slots when preserveCustom is false (default)", () => {
    const fleet = newFleet();
    fleet.namingConfig.vdsTemplate = "vds-{purpose}";
    const inst = fleet.instances[0];
    const dom = inst.domains[0];
    const cl = dom.clusters[0];
    cl.networks.nicProfileId = "4-nic";
    cl.networks.vds = NIC_PROFILES["4-nic"].vds.map((v) => ({ ...v }));
    cl.networks.vds[0] = { ...cl.networks.vds[0], name: "my-custom-vds" };
    const next = applyVdsTemplate(fleet, inst, dom, cl);
    // Without preserveCustom, slot 0 gets re-resolved from the template.
    expect(next.networks.vds[0].name).not.toBe("my-custom-vds");
  });

  it("returns the original cluster object unchanged when cluster has no networks.vds", () => {
    const fleet = newFleet();
    fleet.namingConfig.vdsTemplate = "vds-{purpose}";
    const inst = fleet.instances[0];
    const dom = inst.domains[0];
    const clNoVds = { name: "bare", networks: { nicProfileId: "4-nic" } }; // no vds array
    const result = applyVdsTemplate(fleet, inst, dom, clNoVds);
    expect(result).toBe(clNoVds); // identity — no mutation
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateHostnameFormat — empty non-terminal label (two consecutive dots)
// ─────────────────────────────────────────────────────────────────────────────

describe("validateHostnameFormat — empty non-terminal label", () => {
  it("rejects an empty label in the middle of an FQDN (two consecutive dots)", () => {
    // "esx01..lab.local" → labels = ["esx01", "", "lab", "local"]
    // label[1] = "" and position 1 !== labels.length-1 → error
    const result = validateHostnameFormat("esx01..lab.local");
    expect(result).toMatch(/empty label/);
  });

  it("accepts a trailing dot (rooted FQDN — empty terminal label is OK)", () => {
    // "esx01.lab.local." → labels = ["esx01", "lab", "local", ""]
    // label[3] = "" at position 3 === labels.length-1 → continue (OK)
    const result = validateHostnameFormat("esx01.lab.local.");
    expect(result).toBeNull();
  });

  it("accepts a single-char lowercase hostname", () => {
    expect(validateHostnameFormat("a")).toBeNull();
  });

  it("accepts a 63-char label (exact boundary)", () => {
    const label63 = "a".repeat(63);
    expect(validateHostnameFormat(label63)).toBeNull();
  });

  it("accepts a hostname with numbers only", () => {
    expect(validateHostnameFormat("01")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateNamingDesign — with fleetResult (clusterResults finalHosts path)
// ─────────────────────────────────────────────────────────────────────────────

describe("validateNamingDesign — with fleetResult", () => {
  it("uses fleetResult.clusterResults.finalHosts when provided (not just hostOverrides count)", () => {
    // When a fleetResult is provided the validator iterates up to finalHosts,
    // not just the number of explicit hostOverrides. A fleet with a template
    // set and finalHosts=4 will resolve 4 hostnames.
    const fleet = newFleet();
    fleet.namingConfig.hostTemplate = "{prefix}-{instance}-{cluster}-{role}-{seq:02}";
    fleet.namingConfig.prefix = "vcf";
    const fr = sizeFleet(fleet);
    const issues = validateNamingDesign(fleet, fr);
    // All names should be unique and format-valid → no issues.
    expect(Array.isArray(issues)).toBe(true);
    expect(issues).toHaveLength(0);
  });

  it("validates without fleetResult (falls back to hostOverrides count)", () => {
    // With no fleetResult the validator uses hostOverrides.length (usually 0)
    // → no hosts to check → no issues regardless of template validity.
    const fleet = newFleet();
    fleet.namingConfig.hostTemplate = "INVALID_UPPERCASE_{seq}";
    const issues = validateNamingDesign(fleet);
    // 0 hosts checked → [] issues
    expect(issues).toHaveLength(0);
  });

  it("flags VCF-NAMING-002 for invalid-format names using fleetResult host count", () => {
    const fleet = newFleet();
    // Underscore in template → hostnames will fail validateHostnameFormat
    fleet.namingConfig.hostTemplate = "host_{seq:02}";
    const fr = sizeFleet(fleet);
    const issues = validateNamingDesign(fleet, fr);
    const formatIssues = issues.filter((i) => i.ruleId === "VCF-NAMING-002");
    expect(formatIssues.length).toBeGreaterThan(0);
  });
});
