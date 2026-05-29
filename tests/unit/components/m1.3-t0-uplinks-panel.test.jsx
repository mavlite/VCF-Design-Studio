// @vitest-environment jsdom
//
// M1.3 — T0 Uplinks sub-section component tests.
// Renders the real VcfFleetSizer + drives the UI via userEvent to flip
// the gate condition (cluster.t0Gateways.length > 0).

import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VcfEngine from "../../../engine.js";

let VcfFleetSizer;

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

describe("M1.3 — T0 Uplinks sub-section", () => {
  it("is hidden when no T0 Gateway has been added", () => {
    render(<VcfFleetSizer />);
    expect(screen.queryByLabelText(/^T0 Uplink 1 VLAN$/i)).toBeNull();
    expect(screen.queryByLabelText(/^T0 Uplink 2 VLAN$/i)).toBeNull();
  });

  it("becomes visible after a T0 Gateway is added", async () => {
    const user = userEvent.setup();
    render(<VcfFleetSizer />);
    const addButtons = screen.getAllByRole("button", { name: /Add T0/i });
    await user.click(addButtons[0]);
    expect(screen.getByLabelText(/^T0 Uplink 1 VLAN$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^T0 Uplink 2 VLAN$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^T0 Uplink 1 Gateway$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^T0 Uplink 2 Gateway$/i)).toBeInTheDocument();
  });

  it("typing a VLAN into Uplink 1 updates the input value", async () => {
    const user = userEvent.setup();
    render(<VcfFleetSizer />);
    await user.click(screen.getAllByRole("button", { name: /Add T0/i })[0]);
    const vlan1 = screen.getByLabelText(/^T0 Uplink 1 VLAN$/i);
    await user.type(vlan1, "1647");
    expect(vlan1).toHaveValue(1647);
  });

  it("typing a Gateway into Uplink 1 updates the input value", async () => {
    const user = userEvent.setup();
    render(<VcfFleetSizer />);
    await user.click(screen.getAllByRole("button", { name: /Add T0/i })[0]);
    const gw1 = screen.getByLabelText(/^T0 Uplink 1 Gateway$/i);
    await user.type(gw1, "10.0.16.1");
    expect(gw1).toHaveValue("10.0.16.1");
  });

  it("clearing a populated VLAN coerces back to null (empty input)", async () => {
    const user = userEvent.setup();
    render(<VcfFleetSizer />);
    await user.click(screen.getAllByRole("button", { name: /Add T0/i })[0]);
    const vlan1 = screen.getByLabelText(/^T0 Uplink 1 VLAN$/i);
    await user.type(vlan1, "1647");
    expect(vlan1).toHaveValue(1647);
    await user.clear(vlan1);
    expect(vlan1).toHaveValue(null);
  });
});
