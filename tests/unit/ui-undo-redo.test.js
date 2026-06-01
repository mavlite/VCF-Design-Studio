import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Structural regression guard for the Undo/Redo history hook + UI
// buttons. The history layer wraps useState to track past + future
// snapshots of the fleet; new buttons in the toolbar + keyboard
// shortcuts (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) call undo() / redo().

const JSX_PATH = path.resolve(__dirname, "../../vcf-design-studio-v9.jsx");

describe("UI — undo/redo history", () => {
  const src = fs.readFileSync(JSX_PATH, "utf8");

  it("useFleetHistory hook exists with bounded past/future stacks", () => {
    expect(src).toMatch(/function useFleetHistory\(initial, opts\)/);
    // Limit defaults to 100 snapshots.
    expect(src).toMatch(/const limit = \(opts && opts\.limit\) \|\| 100/);
    // Past/future state.
    expect(src).toMatch(/const \[past, setPast\] = useState\(\[\]\)/);
    expect(src).toMatch(/const \[future, setFuture\] = useState\(\[\]\)/);
    // Returns the API surface.
    expect(src).toMatch(/return \{ state, setState, undo, redo, canUndo: past\.length > 0, canRedo: future\.length > 0 \}/);
  });

  it("setState short-circuits when next === prev (no history push on identity)", () => {
    expect(src).toMatch(/if \(next === prev\) return prev;/);
  });

  it("setState pushes current to past and clears future on any change", () => {
    // The change branch should: push prev to past, clear future, return next.
    const setStateBlock = src.match(/const setState = useCallback[\s\S]+?\}, \[limit\]\);/);
    expect(setStateBlock, "setState callback").toBeTruthy();
    expect(setStateBlock[0]).toMatch(/setPast\(/);
    expect(setStateBlock[0]).toMatch(/setFuture\(\[\]\)/);
  });

  it("undo pops past + pushes current to future; redo is the inverse", () => {
    const undoBlock = src.match(/const undo = useCallback[\s\S]+?\}, \[limit\]\);/);
    expect(undoBlock, "undo callback").toBeTruthy();
    expect(undoBlock[0]).toMatch(/p\.slice\(0, -1\)/);
    expect(undoBlock[0]).toMatch(/setFuture/);
    const redoBlock = src.match(/const redo = useCallback[\s\S]+?\}, \[limit\]\);/);
    expect(redoBlock, "redo callback").toBeTruthy();
    expect(redoBlock[0]).toMatch(/f\.slice\(1\)/);
    expect(redoBlock[0]).toMatch(/setPast/);
  });

  it("Editor uses useFleetHistory instead of useState for fleet state", () => {
    expect(src).toMatch(/const fleetHistory = useFleetHistory\(newFleet\(\)\);/);
    expect(src).toMatch(/const fleet = fleetHistory\.state/);
    expect(src).toMatch(/const setFleet = fleetHistory\.setState/);
  });

  it("Keyboard shortcuts wire Ctrl/Cmd+Z to undo + Ctrl/Cmd+Shift+Z or +Y to redo", () => {
    // Suppress shortcuts when focus is in INPUT/TEXTAREA/SELECT (native undo wins for typing).
    expect(src).toMatch(/if \(tag === "INPUT" \|\| tag === "TEXTAREA" \|\| tag === "SELECT"\) return/);
    expect(src).toMatch(/key === "z" && !e\.shiftKey[\s\S]+?undo\(\)/);
    expect(src).toMatch(/key === "z" && e\.shiftKey[\s\S]+?redo\(\)/);
    expect(src).toMatch(/key === "y"[\s\S]+?redo\(\)/);
  });

  it("Toolbar renders Undo + Redo buttons that disable when stack is empty", () => {
    expect(src).toMatch(/onClick=\{undo\}[\s\S]+?disabled=\{!canUndo\}[\s\S]+?↶ Undo/);
    expect(src).toMatch(/onClick=\{redo\}[\s\S]+?disabled=\{!canRedo\}[\s\S]+?↷ Redo/);
  });
});
