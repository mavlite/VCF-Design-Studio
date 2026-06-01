import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Structural regression guard for the cluster/domain/instance clone
// buttons added in feat/editor-workflow-improvements. The clone path
// mirrors the existing add/remove pattern but goes through a deep-clone
// helper `cloneWithFreshIds` that regenerates every nested `id` field
// so cross-references to the original don't leak.
//
// No JSDOM is configured in this repo, so we lean on static-string
// inspection of the JSX source (same pattern as the AdvancedSettings
// regression test from PR #95). Catches reverts that drop the buttons
// or swap the helper.

const JSX_PATH = path.resolve(__dirname, "../../vcf-design-studio-v9.jsx");

describe("UI — clone buttons (cluster / domain / instance)", () => {
  const src = fs.readFileSync(JSX_PATH, "utf8");

  it("cloneWithFreshIds helper regenerates every nested id and appends ' (copy)' to name", () => {
    expect(src).toMatch(/function cloneWithFreshIds\(obj, opts\)/);
    // Regenerates id at every depth — recursive, not just root.
    expect(src).toMatch(/if \(k === "id"[\s\S]+?out\[k\] = localId\(\)/);
    // Appends " (copy)" to top-level name when opts.appendNameSuffix.
    expect(src).toMatch(/appendNameSuffix[\s\S]+?\$\{out\.name\} \(copy\)/);
  });

  it("DomainCard exposes cloneCluster + passes onClone to ClusterCard", () => {
    expect(src).toMatch(/const cloneCluster = \(idx\) =>/);
    // Cloned cluster gets isDefault=false so it's not confused with the
    // domain's first/default cluster.
    expect(src).toMatch(/cloneCluster[\s\S]+?copy\.isDefault = false/);
    expect(src).toMatch(/onClone=\{\(\) => cloneCluster\(i\)\}/);
  });

  it("InstanceCard exposes cloneDomain + passes onClone to DomainCard (skipped for mgmt)", () => {
    expect(src).toMatch(/const cloneDomain = \(idx\) =>/);
    // mgmt domain can't be cloned (one mgmt per instance — VCF-INV-002).
    expect(src).toMatch(/cloneDomain[\s\S]+?if \(src\.type === "mgmt"\) return/);
    // onClone wires to null for mgmt domains.
    expect(src).toMatch(/onClone=\{d\.type !== "mgmt" \? \(\) => cloneDomain\(i\) : null\}/);
  });

  it("Editor exposes cloneInstance + passes onClone to InstanceCard", () => {
    expect(src).toMatch(/const cloneInstance = \(idx\) =>/);
    expect(src).toMatch(/onClone=\{\(\) => cloneInstance\(i\)\}/);
  });

  it("ClusterCard renders the CLONE button next to REMOVE", () => {
    // Button has the documented click handler + label.
    expect(src).toMatch(/onClick=\{onClone\}[\s\S]+?CLONE/);
  });

  it("DomainCard renders the 'Clone Domain' button + signature accepts onClone", () => {
    expect(src).toMatch(/function DomainCard\(\{[\s\S]+?onClone[\s\S]+?\}\)/);
    expect(src).toMatch(/Clone Domain/);
  });

  it("InstanceCard renders the 'Clone Instance' button + signature accepts onClone", () => {
    expect(src).toMatch(/function InstanceCard\(\{[\s\S]+?onClone[\s\S]+?\}\)/);
    expect(src).toMatch(/Clone Instance/);
  });
});
