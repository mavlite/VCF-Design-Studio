// @vitest-environment jsdom
//
// Capability Tray component tests.
// Renders CapabilityTray in isolation, driven by engine-produced ctx objects.

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import VcfEngine from "../../../engine.js";

let CapabilityTray;
const engine = VcfEngine;

beforeAll(async () => {
  window.VcfEngine = VcfEngine;
  globalThis.XLSX = globalThis.XLSX || {
    read: () => ({}),
    write: () => "",
    utils: { sheet_to_json: () => [] },
  };
  const mod = await import("../../../vcf-design-studio-v9.jsx");
  CapabilityTray = mod.CapabilityTray;
});

const clusterCtx = () => {
  const cluster = engine.newFleet().instances[0].domains[0].clusters[0];
  return { cluster };
};

describe("CapabilityTray", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("renders a chip per cluster capability with core chips", () => {
    render(<CapabilityTray scope="cluster" ctx={clusterCtx()} coreLabels={["Host & Sizing","Storage (vSAN)"]} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: /NSX Edge \+ T0\/BGP/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /vSphere Supervisor \(VKS\)/ })).toBeInTheDocument();
    expect(screen.getByText("Host & Sizing")).toBeInTheDocument();
  });

  it("toggles an off capability on without confirm", () => {
    const onToggle = vi.fn();
    render(<CapabilityTray scope="cluster" ctx={clusterCtx()} coreLabels={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /NSX Edge \+ T0\/BGP/ }));
    expect(onToggle).toHaveBeenCalledWith("edge", true);
  });

  it("confirms before disabling a capability that has data", () => {
    const ctx = clusterCtx();
    ctx.cluster.edgeCluster.enabled = true;
    ctx.cluster.edgeCluster.name = "edge-01"; // has data
    const onToggle = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<CapabilityTray scope="cluster" ctx={ctx} coreLabels={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /NSX Edge \+ T0\/BGP/ }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled(); // user cancelled
  });

  it("disables a capability with data when the user confirms", () => {
    const ctx = clusterCtx();
    ctx.cluster.edgeCluster.enabled = true;
    ctx.cluster.edgeCluster.name = "edge-01"; // has data
    const onToggle = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<CapabilityTray scope="cluster" ctx={ctx} coreLabels={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /NSX Edge \+ T0\/BGP/ }));
    expect(onToggle).toHaveBeenCalledWith("edge", false);
  });

  it("excludeKeys hides the named capability chip", () => {
    render(<CapabilityTray scope="cluster" ctx={clusterCtx()} coreLabels={[]} excludeKeys={["advanced"]} onToggle={() => {}} />);
    expect(screen.queryByRole("button", { name: /Advanced \(EVC \/ naming\)/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /NSX Edge \+ T0\/BGP/ })).toBeInTheDocument();
  });

  it("export-gated capability confirm mentions exclusion from output", () => {
    const ctx = clusterCtx();
    ctx.cluster.edgeCluster.enabled = true;
    ctx.cluster.edgeCluster.name = "edge-01"; // has data
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<CapabilityTray scope="cluster" ctx={ctx} coreLabels={[]} onToggle={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /NSX Edge \+ T0\/BGP/ }));
    expect(confirmSpy.mock.calls[0][0]).toMatch(/excludes it from the design output/i);
  });

  it("visibility-only capability confirm says data still exports", () => {
    const ctx = clusterCtx();
    ctx.cluster.tiering.enabled = true;
    ctx.cluster.tiering.nvmePct = 80; // has data (non-default)
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<CapabilityTray scope="cluster" ctx={ctx} coreLabels={[]} onToggle={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /NVMe Tiering/ }));
    expect(confirmSpy.mock.calls[0][0]).toMatch(/still exports/i);
  });
});

describe("CapabilityTray — group section labels", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("renders the registry group names as section labels for the cluster scope", () => {
    render(<CapabilityTray scope="cluster" ctx={clusterCtx()} coreLabels={[]} onToggle={() => {}} />);
    // Cluster capabilities span these groups (from CAPABILITY_REGISTRY .group):
    expect(screen.getByText("Networking")).toBeInTheDocument();
    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(screen.getByText("Advanced")).toBeInTheDocument();
    // Chips still render (a Networking-group member and a Storage-group member).
    expect(screen.getByRole("button", { name: /NSX Edge \+ T0\/BGP/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /NVMe Tiering/ })).toBeInTheDocument();
  });

  it("groups are derived from the engine registry, not hardcoded", () => {
    const expected = [...new Set(engine.capabilitiesForScope("cluster").map((c) => c.group))];
    render(<CapabilityTray scope="cluster" ctx={clusterCtx()} coreLabels={[]} onToggle={() => {}} />);
    for (const g of expected) expect(screen.getByText(g)).toBeInTheDocument();
  });
});

describe("CapabilityTray — core label vs group label disambiguation", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("core 'Networking (VLAN/MTU)' chip does not textually collide with the 'Networking' group label", () => {
    render(<CapabilityTray scope="cluster" ctx={clusterCtx()}
      coreLabels={["Host & Sizing", "Storage (vSAN)", "Networking (VLAN/MTU)", "Appliance Stack"]}
      onToggle={() => {}} />);
    // exactly one "Networking" (the capability-group label), not two
    expect(screen.getAllByText("Networking")).toHaveLength(1);
    // the core networking chip is the disambiguated label
    expect(screen.getByText("Networking (VLAN/MTU)")).toBeInTheDocument();
  });
});
