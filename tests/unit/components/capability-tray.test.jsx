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
    expect(screen.getByText("NSX Edge + T0/BGP")).toBeInTheDocument();
    expect(screen.getByText("vSphere Supervisor (VKS)")).toBeInTheDocument();
    expect(screen.getByText("Host & Sizing")).toBeInTheDocument();
  });

  it("toggles an off capability on without confirm", () => {
    const onToggle = vi.fn();
    render(<CapabilityTray scope="cluster" ctx={clusterCtx()} coreLabels={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByText("NSX Edge + T0/BGP"));
    expect(onToggle).toHaveBeenCalledWith("edge", true);
  });

  it("confirms before disabling a capability that has data", () => {
    const ctx = clusterCtx();
    ctx.cluster.edgeCluster.enabled = true;
    ctx.cluster.edgeCluster.name = "edge-01"; // has data
    const onToggle = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<CapabilityTray scope="cluster" ctx={ctx} coreLabels={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByText(/NSX Edge \+ T0\/BGP/));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled(); // user cancelled
  });
});
