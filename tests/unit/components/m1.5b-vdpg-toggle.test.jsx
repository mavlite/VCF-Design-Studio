// @vitest-environment jsdom
//
// M1.5b — fleet-header "VCF Ops/Auto on dedicated segment" toggle.
// The default fleet boots at VCF 9.1 (DEFAULT_VCF_VERSION_NEW), and the
// toggle is gated to 9.1, so it renders on boot. Clicking it flips
// fleet.vcfOpsDeployToVdpg (which stamps Deploy Mgmt L47 on export).
import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VcfEngine from "../../../engine.js";

let VcfFleetSizer;

beforeAll(async () => {
  window.VcfEngine = VcfEngine;
  globalThis.XLSX = globalThis.XLSX || { read: () => ({}), write: () => "", utils: { sheet_to_json: () => [] } };
  const mod = await import("../../../vcf-design-studio-v9.jsx");
  VcfFleetSizer = mod.default;
});

describe("M1.5b — VCF Ops/Auto vDPG toggle", () => {
  it("renders the toggle on a 9.1 fleet, unchecked by default", () => {
    render(<VcfFleetSizer />);
    const toggle = screen.getByLabelText(/VCF Ops\/Auto on dedicated segment/i);
    expect(toggle).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
  });

  it("toggles on click", async () => {
    const user = userEvent.setup();
    render(<VcfFleetSizer />);
    const toggle = screen.getAllByLabelText(/VCF Ops\/Auto on dedicated segment/i)[0];
    await user.click(toggle);
    expect(toggle).toBeChecked();
  });
});
