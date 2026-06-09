// @vitest-environment jsdom
//
// Capability Tray smoke — default-hidden progressive disclosure.
//
// Renders the full VcfFleetSizer app in JSDOM and asserts that:
//   1. Optional cluster panels are HIDDEN by default (edge defaults off).
//   2. Clicking the "Enable NSX Edge + T0/BGP" tray chip reveals the panel.
//
// Uses the same window.VcfEngine + dynamic-import pattern as
// m1.3-edge-node-gateway-ips.test.jsx and studio-boot.test.jsx.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VcfEngine from "../../../engine.js";

let VcfFleetSizer;

beforeEach(() => { try { localStorage.clear(); } catch (e) {} });

beforeAll(async () => {
  window.VcfEngine = VcfEngine;
  globalThis.XLSX = globalThis.XLSX || {
    read: () => ({}),
    write: () => "",
    utils: { sheet_to_json: () => [] },
  };
  const mod = await import("../../../vcf-design-studio-v9.jsx");
  VcfFleetSizer = mod.default;
});

describe("Capability Tray — default-hidden progressive disclosure", () => {
  it("NSX Edge Cluster panel is absent on a default fleet (edge defaults off)", () => {
    render(<VcfFleetSizer />);
    // Section renders <h4>NSX Edge Cluster</h4>; it should not exist before
    // the capability chip is toggled on.
    expect(
      screen.queryByText("NSX Edge Cluster")
    ).not.toBeInTheDocument();
  });

  it("NSX Edge Cluster panel appears after enabling the tray chip", async () => {
    const user = userEvent.setup();
    render(<VcfFleetSizer />);
    // Chip title is "Enable NSX Edge + T0/BGP" when capability is off.
    const chip = screen.getAllByTitle(/^Enable NSX Edge \+ T0\/BGP$/i)[0];
    await user.click(chip);
    // After enabling, EdgeClusterPanel mounts and Section renders the heading.
    expect(screen.getByText("NSX Edge Cluster")).toBeInTheDocument();
  });

  it("Stretched-cluster AZ2 Overlay is hidden on a non-stretched (default single-site) cluster", () => {
    // A brand-new fleet is single-site, so its mgmt domain placement is "local".
    // The AZ2 overlay is gated on the domain's "stretched" capability, so it
    // must not render until the cluster's domain is identified as stretched.
    render(<VcfFleetSizer />);
    expect(screen.queryByText("Stretched-cluster AZ2 Overlay")).not.toBeInTheDocument();
  });
});
