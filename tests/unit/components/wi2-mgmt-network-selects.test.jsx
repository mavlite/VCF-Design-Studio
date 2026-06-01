// @vitest-environment jsdom
//
// WI-2 — fleet-header VM/VCF management-network selects (9.1 only). The
// default fleet boots at 9.1, so both render with their default values.
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

describe("WI-2 — management-network selects", () => {
  it("VM Mgmt Network renders + changes on a 9.1 fleet", async () => {
    const user = userEvent.setup();
    render(<VcfFleetSizer />);
    const sel = screen.getByLabelText(/VM Mgmt Network/i);
    expect(sel).toHaveValue("Use a separate dedicated network");
    await user.selectOptions(sel, "Use ESX management network");
    expect(sel).toHaveValue("Use ESX management network");
  });

  it("VCF Mgmt Network renders with its default", () => {
    render(<VcfFleetSizer />);
    const sel = screen.getAllByLabelText(/VCF Mgmt Network/i)[0];
    expect(sel).toHaveValue("Use VM management network");
  });
});
