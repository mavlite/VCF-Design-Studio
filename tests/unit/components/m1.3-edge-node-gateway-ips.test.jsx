// @vitest-environment jsdom
//
// M1.3 — Per-node Gateway Interface IPs row tests.
// EdgeClusterPanel renders unconditionally, so the new row is reachable
// from a default-fleet render without any UI setup.

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

describe("M1.3 — per-node Gateway Interface IPs row", () => {
  // [0] = first ClusterCard (mgmt cluster) — newFleet() produces a single
  // instance/domain/cluster, so index 0 is unambiguous in the default fixture.

  it("renders the row in every Edge Node block", () => {
    render(<VcfFleetSizer />);
    const ips = screen.getAllByLabelText(/^Edge Node [12] Uplink [12] IP$/i);
    expect(ips.length % 4).toBe(0);
    expect(ips.length).toBeGreaterThanOrEqual(4);
  });

  it("typing in Edge Node 1 Uplink 1 IP updates its input value", async () => {
    const user = userEvent.setup();
    render(<VcfFleetSizer />);
    const n1u1 = screen.getAllByLabelText(/^Edge Node 1 Uplink 1 IP$/i)[0];
    await user.type(n1u1, "10.0.17.2/24");
    expect(n1u1).toHaveValue("10.0.17.2/24");
  });

  it("typing in Edge Node 2 Uplink 2 IP updates only that input", async () => {
    const user = userEvent.setup();
    render(<VcfFleetSizer />);
    const n2u2 = screen.getAllByLabelText(/^Edge Node 2 Uplink 2 IP$/i)[0];
    const n1u1 = screen.getAllByLabelText(/^Edge Node 1 Uplink 1 IP$/i)[0];
    const n1u2 = screen.getAllByLabelText(/^Edge Node 1 Uplink 2 IP$/i)[0];
    const n2u1 = screen.getAllByLabelText(/^Edge Node 2 Uplink 1 IP$/i)[0];
    await user.type(n2u2, "10.0.18.3/24");
    expect(n2u2).toHaveValue("10.0.18.3/24");
    expect(n1u1).toHaveValue("");
    expect(n1u2).toHaveValue("");
    expect(n2u1).toHaveValue("");
  });

  it("editing Node 1 does not mutate Node 2 inputs", async () => {
    const user = userEvent.setup();
    render(<VcfFleetSizer />);
    const n1u1 = screen.getAllByLabelText(/^Edge Node 1 Uplink 1 IP$/i)[0];
    const n1u2 = screen.getAllByLabelText(/^Edge Node 1 Uplink 2 IP$/i)[0];
    const n2u1 = screen.getAllByLabelText(/^Edge Node 2 Uplink 1 IP$/i)[0];
    const n2u2 = screen.getAllByLabelText(/^Edge Node 2 Uplink 2 IP$/i)[0];
    await user.type(n1u1, "10.0.17.2/24");
    await user.type(n1u2, "10.0.17.3/24");
    expect(n2u1).toHaveValue("");
    expect(n2u2).toHaveValue("");
  });
});
