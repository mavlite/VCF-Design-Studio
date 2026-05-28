// Global setup for jsdom-environment tests (M2.2). Imports
// @testing-library/jest-dom so component tests can use the extended
// matchers (toBeInTheDocument, toHaveTextContent, etc.) without
// repeating the import in every test file.
//
// This file only runs for tests whose path matches the
// `environmentMatchGlobs` entry in vitest.config.js — engine-side
// tests under tests/unit/themes/, tests/migration/, etc. don't pay
// the jsdom startup cost.

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// @testing-library/react 13+ auto-registers cleanup when running under
// Jest globals. Under vitest without `globals: true`, no afterEach is
// auto-attached — register it explicitly here so rendered components
// don't accumulate across tests in the same file.
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement window.matchMedia; the studio's components
// use it in a couple of places for responsive logic. Provide a noop
// stub so render() doesn't throw on first paint.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}
