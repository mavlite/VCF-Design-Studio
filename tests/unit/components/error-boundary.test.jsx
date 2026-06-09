// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import VcfEngine from "../../../engine.js";
let ErrorBoundary;
beforeAll(async () => {
  window.VcfEngine = VcfEngine;
  globalThis.XLSX = globalThis.XLSX || { read: () => ({}), write: () => "", utils: { sheet_to_json: () => [] } };
  ErrorBoundary = (await import("../../../vcf-design-studio-v9.jsx")).ErrorBoundary;
});
function Boom() { throw new Error("boom"); }
describe("ErrorBoundary", () => {
  it("renders children normally when they don't throw", () => {
    render(<ErrorBoundary><div>ok-content</div></ErrorBoundary>);
    expect(screen.getByText("ok-content")).toBeInTheDocument();
  });
  it("renders a recovery fallback (not blank) when a child throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // silence React's error log
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reload/i })).toBeInTheDocument();
  });
});
