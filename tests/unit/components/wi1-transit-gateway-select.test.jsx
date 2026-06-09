// @vitest-environment jsdom
//
// WI-1 — fleet-header "Transit Gateway" select (9.1 only). The default
// fleet boots at 9.1, so the select renders; changing it updates
// fleet.transitGatewayType (stamps Deploy Mgmt L53 on export).
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VcfEngine from "../../../engine.js";

let VcfFleetSizer;

beforeEach(() => { try { localStorage.clear(); } catch (e) {} });

beforeAll(async () => {
  window.VcfEngine = VcfEngine;
  globalThis.XLSX = globalThis.XLSX || { read: () => ({}), write: () => "", utils: { sheet_to_json: () => [] } };
  const mod = await import("../../../vcf-design-studio-v9.jsx");
  VcfFleetSizer = mod.default;
});

describe("WI-1 — Transit Gateway type select", () => {
  it("renders on a 9.1 fleet, defaulting to Centralized connectivity", () => {
    render(<VcfFleetSizer />);
    const sel = screen.getByLabelText(/Transit Gateway/i);
    expect(sel).toBeInTheDocument();
    expect(sel).toHaveValue("Centralized connectivity");
  });

  it("changes to Distributed connectivity on selection", async () => {
    const user = userEvent.setup();
    render(<VcfFleetSizer />);
    const sel = screen.getAllByLabelText(/Transit Gateway/i)[0];
    await user.selectOptions(sel, "Distributed connectivity");
    expect(sel).toHaveValue("Distributed connectivity");
  });
});
