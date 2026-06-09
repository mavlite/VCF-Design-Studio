// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import VcfEngine from "../../../engine.js";
let VcfFleetSizer;
beforeAll(async () => {
  window.VcfEngine = VcfEngine;
  globalThis.XLSX = globalThis.XLSX || { read: () => ({}), write: () => "", utils: { sheet_to_json: () => [] } };
  VcfFleetSizer = (await import("../../../vcf-design-studio-v9.jsx")).default;
});
beforeEach(() => { try { localStorage.clear(); } catch (e) {} });
describe("privacy note", () => {
  it("states processing is in-browser and nothing is uploaded", () => {
    render(<VcfFleetSizer />);
    expect(screen.getByText(/never uploaded/i)).toBeInTheDocument();
    expect(screen.getByText(/in your browser/i)).toBeInTheDocument();
  });
});
