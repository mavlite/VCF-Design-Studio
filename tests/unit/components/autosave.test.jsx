// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import VcfEngine from "../../../engine.js";
const KEY = "vcf-studio:autosave";
let VcfFleetSizer;
beforeAll(async () => {
  window.VcfEngine = VcfEngine;
  globalThis.XLSX = globalThis.XLSX || { read: () => ({}), write: () => "", utils: { sheet_to_json: () => [] } };
  VcfFleetSizer = (await import("../../../vcf-design-studio-v9.jsx")).default;
});
beforeEach(() => { try { localStorage.clear(); } catch (e) {} vi.restoreAllMocks(); });

describe("autosave + restore", () => {
  it("a fresh visit shows no restore banner and writes no autosave initially", () => {
    render(<VcfFleetSizer />);
    expect(screen.queryByText(/Restored your previous design/i)).not.toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
  it("editing the fleet name persists an autosave (debounced)", async () => {
    vi.useFakeTimers();
    try {
      render(<VcfFleetSizer />);
      const nameInput = screen.getByDisplayValue("Production Fleet");
      fireEvent.change(nameInput, { target: { value: "My Fleet" } });
      await act(async () => { vi.advanceTimersByTime(800); });
      const saved = JSON.parse(localStorage.getItem(KEY));
      expect(saved.fleet.name).toBe("My Fleet");
      expect(saved.version).toBe("vcf-sizer-v9");
    } finally {
      vi.useRealTimers();
    }
  });
  it("restores a seeded autosave on load and shows a dismissible banner", () => {
    const fleet = { ...VcfEngine.newFleet(), name: "Restored Fleet" };
    localStorage.setItem(KEY, JSON.stringify({ version: "vcf-sizer-v9", savedAt: new Date(0).toISOString(), fleet }));
    render(<VcfFleetSizer />);
    expect(screen.getByDisplayValue("Restored Fleet")).toBeInTheDocument();
    expect(screen.getByText(/Restored your previous design/i)).toBeInTheDocument();
  });
  it("'Start fresh' resets to a new fleet and clears the autosave", () => {
    const fleet = { ...VcfEngine.newFleet(), name: "Restored Fleet" };
    localStorage.setItem(KEY, JSON.stringify({ version: "vcf-sizer-v9", savedAt: new Date(0).toISOString(), fleet }));
    render(<VcfFleetSizer />);
    fireEvent.click(screen.getByRole("button", { name: /Start fresh/i }));
    expect(screen.getByDisplayValue("Production Fleet")).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(screen.queryByText(/Restored your previous design/i)).not.toBeInTheDocument();
  });
  it("a malformed autosave is ignored without crashing", () => {
    localStorage.setItem(KEY, "{not json");
    render(<VcfFleetSizer />);
    expect(screen.getByDisplayValue("Production Fleet")).toBeInTheDocument();
    expect(screen.queryByText(/Restored your previous design/i)).not.toBeInTheDocument();
  });
});

describe("flush-on-unload (pristine-no-save invariant)", () => {
  it("closing a never-edited tab writes no autosave", () => {
    render(<VcfFleetSizer />);
    window.dispatchEvent(new Event("beforeunload"));
    expect(localStorage.getItem(KEY)).toBeNull();
  });
  it("closing after an edit flushes the latest design synchronously", () => {
    render(<VcfFleetSizer />);
    const nameInput = screen.getByDisplayValue("Production Fleet");
    fireEvent.change(nameInput, { target: { value: "Edited Before Close" } });
    window.dispatchEvent(new Event("beforeunload"));
    const saved = JSON.parse(localStorage.getItem(KEY));
    expect(saved.fleet.name).toBe("Edited Before Close");
  });
});
