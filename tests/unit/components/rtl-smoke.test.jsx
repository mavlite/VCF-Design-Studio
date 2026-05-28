// @vitest-environment jsdom
//
// M2.2 — JSDOM + React Testing Library smoke test.
//
// Proves the test infrastructure works end-to-end:
//   - vitest runs this file in the jsdom environment (per
//     environmentMatchGlobs in vitest.config.js)
//   - @vitejs/plugin-react transforms the JSX
//   - @testing-library/react renders into the jsdom DOM
//   - @testing-library/jest-dom matchers are auto-loaded by the
//     tests/setup/jsdom-setup.js setup file
//
// This is the canonical "hello world" for the M2.2 stack. Future
// component tests should follow the same pattern: define small,
// focused components or import existing ones, render them, and
// assert on the rendered DOM via Testing Library queries.

import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

function CounterButton({ initial = 0 }) {
  const [n, setN] = useState(initial);
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      clicked {n} times
    </button>
  );
}

describe("M2.2 — JSDOM + RTL infrastructure smoke", () => {
  it("renders a simple component into the jsdom DOM", () => {
    render(<CounterButton />);
    expect(screen.getByRole("button")).toHaveTextContent("clicked 0 times");
  });

  it("loads @testing-library/jest-dom matchers from the global setup", () => {
    render(<CounterButton initial={5} />);
    const btn = screen.getByRole("button");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent(/clicked 5 times/);
  });

  it("supports user-event interactions and React state updates", async () => {
    render(<CounterButton />);
    const user = userEvent.setup();
    const btn = screen.getByRole("button");
    await user.click(btn);
    await user.click(btn);
    expect(btn).toHaveTextContent("clicked 2 times");
  });
});
