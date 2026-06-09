# Pre-launch Resilience & Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the studio fail gracefully (error boundary), never silently lose work (localStorage autosave + restore banner), and state its client-only privacy posture — before publishing live.

**Architecture:** Pure client-side React additions in `vcf-design-studio-v9.jsx` + one mount-line change in `scripts/build-html.mjs`. No backend, no network, no new deps. The design `fleet` (small JSON, NOT the workbook) autosaves to `localStorage`; restore runs through `migrateFleet`.

**Tech Stack:** React 18 (function components + one class for the error boundary), Vitest + Testing Library (JSDOM), `npm run build-html`.

**Spec:** `docs/superpowers/specs/2026-06-09-pre-launch-resilience-and-trust-design.md`.

**Conventions (read first):**
- After ANY `engine.js`/`.jsx`/`build-html.mjs` change: `npm run build-html` then `npm run verify-html` (the shipped HTML embeds the JSX; don't skip).
- No Claude/AI attribution in commits. Single test: `npx vitest run <path>`. Full: `npm test`.
- Components are exported for tests the same way `CapabilityTray` is (`export { CapabilityTray }`; tests do `mod.CapabilityTray` after a dynamic import with `window.VcfEngine` set — read `tests/unit/components/capability-tray.test.jsx` for the harness).
- Hooks (`useState/useEffect/useMemo/useRef/useCallback`) and engine fns (`newFleet`, `migrateFleet`) are already in scope in the JSX.
- **localStorage hygiene in tests/E2E:** the autosave key persists across renders; tests must clear it in `beforeEach`, and the existing E2E must start from a clean slate (no banner on first visit).

**Autosave key:** `vcf-studio:autosave`. **Payload:** `{ version: "vcf-sizer-v9", savedAt: <ISO>, fleet }`.

---

## File Structure

| File | Change |
|------|--------|
| `vcf-design-studio-v9.jsx` | Privacy note; `ErrorBoundary` class + export; autosave/restore (bootstrap + effects + banner) in `VcfFleetSizer` |
| `scripts/build-html.mjs` | Wrap the mount line in `<ErrorBoundary>` |
| `tests/unit/components/error-boundary.test.jsx` | Create |
| `tests/unit/components/autosave.test.jsx` | Create |
| `tests/unit/components/privacy-note.test.jsx` | Create (or fold into an existing app-render test) |
| `vcf-design-studio-v9.html` | Regenerated |

---

## Task 1: Privacy / trust note (#4)

**Files:** Modify `vcf-design-studio-v9.jsx` (header chrome); Test `tests/unit/components/privacy-note.test.jsx`.

- [ ] **Step 1: Write the failing test**

First read how the app header renders (grep the JSX for the top `<header` or the fleet-name input ~line 9080 area) to find a stable insertion point and the render harness. Create `tests/unit/components/privacy-note.test.jsx` mirroring the `capability-tray.test.jsx` harness (window.VcfEngine + dynamic import of the default `VcfFleetSizer`):

```jsx
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
beforeEach(() => { localStorage.clear(); });
describe("privacy note", () => {
  it("states processing is in-browser and nothing is uploaded", () => {
    render(<VcfFleetSizer />);
    expect(screen.getByText(/never uploaded/i)).toBeInTheDocument();
    expect(screen.getByText(/in your browser/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — must FAIL** (`npx vitest run tests/unit/components/privacy-note.test.jsx`): no such text yet.

- [ ] **Step 3: Add the note**

In the app header/footer chrome (a stable spot near the top-level title or the export-row), add one muted line:

```jsx
<p className="text-[10px] text-slate-400 font-mono mt-0.5">
  All processing happens in your browser — your design and any generated passwords are never uploaded.
</p>
```

Place it where it reads as a subtitle/footnote (read the surrounding JSX and match the layout — e.g. just under the app title or in the existing header flex column). Keep it to one line.

- [ ] **Step 4: Run — must PASS.** Then `npm run build-html && npm run verify-html`; `npx vitest run tests/unit/components`.

- [ ] **Step 5: Commit**

```
git add vcf-design-studio-v9.jsx vcf-design-studio-v9.html tests/unit/components/privacy-note.test.jsx
git commit -m "feat(pre-launch): in-app privacy note (client-only processing)"
```

---

## Task 2: Persistence — autosave + restore banner (#3)

**Files:** Modify `vcf-design-studio-v9.jsx` (`VcfFleetSizer`); Test `tests/unit/components/autosave.test.jsx`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/autosave.test.jsx`:

```jsx
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
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("autosave + restore", () => {
  it("a fresh visit shows no restore banner and writes no autosave initially", () => {
    render(<VcfFleetSizer />);
    expect(screen.queryByText(/Restored your previous design/i)).not.toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull(); // pristine session does not autosave
  });

  it("editing the fleet name persists an autosave (debounced)", async () => {
    vi.useFakeTimers();
    render(<VcfFleetSizer />);
    const nameInput = screen.getByDisplayValue("Production Fleet"); // newFleet().name
    fireEvent.change(nameInput, { target: { value: "My Fleet" } });
    await act(async () => { vi.advanceTimersByTime(800); }); // past the 750ms debounce
    const saved = JSON.parse(localStorage.getItem(KEY));
    expect(saved.fleet.name).toBe("My Fleet");
    expect(saved.version).toBe("vcf-sizer-v9");
    vi.useRealTimers();
  });

  it("restores a seeded autosave on load and shows a dismissible banner", () => {
    const fleet = VcfEngine.newFleet(); fleet.name = "Restored Fleet";
    localStorage.setItem(KEY, JSON.stringify({ version: "vcf-sizer-v9", savedAt: new Date(0).toISOString(), fleet }));
    render(<VcfFleetSizer />);
    expect(screen.getByDisplayValue("Restored Fleet")).toBeInTheDocument();
    expect(screen.getByText(/Restored your previous design/i)).toBeInTheDocument();
  });

  it("'Start fresh' resets to a new fleet and clears the autosave", () => {
    const fleet = VcfEngine.newFleet(); fleet.name = "Restored Fleet";
    localStorage.setItem(KEY, JSON.stringify({ version: "vcf-sizer-v9", savedAt: new Date(0).toISOString(), fleet }));
    render(<VcfFleetSizer />);
    fireEvent.click(screen.getByRole("button", { name: /Start fresh/i }));
    expect(screen.getByDisplayValue("Production Fleet")).toBeInTheDocument(); // back to newFleet().name
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(screen.queryByText(/Restored your previous design/i)).not.toBeInTheDocument();
  });

  it("a malformed autosave is ignored without crashing", () => {
    localStorage.setItem(KEY, "{not json");
    render(<VcfFleetSizer />);
    expect(screen.getByDisplayValue("Production Fleet")).toBeInTheDocument(); // falls back to newFleet
    expect(screen.queryByText(/Restored your previous design/i)).not.toBeInTheDocument();
  });
});
```

(Confirm `newFleet().name` is `"Production Fleet"` — it is, per engine.js `newFleet`. If the fleet-name input isn't found by `getByDisplayValue`, read how the name input renders and adjust the query.)

- [ ] **Step 2: Run — must FAIL.**

- [ ] **Step 3: Implement bootstrap restore + banner state**

In `VcfFleetSizer` (~line 7932), BEFORE `useFleetHistory`, add a one-time bootstrap that loads the autosave (or a fresh fleet):

```jsx
  const AUTOSAVE_KEY = "vcf-studio:autosave";
  // One-time bootstrap: restore the last autosaved design (migrated) or start fresh.
  const bootstrap = useMemo(() => {
    try {
      const raw = (typeof localStorage !== "undefined") && localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return { fleet: newFleet(), restoredAt: null };
      const parsed = JSON.parse(raw);
      return { fleet: migrateFleet(parsed.fleet ?? parsed), restoredAt: parsed.savedAt || true };
    } catch (e) {
      return { fleet: newFleet(), restoredAt: null };
    }
  }, []);
  const fleetHistory = useFleetHistory(bootstrap.fleet);
  const fleet = fleetHistory.state;
  const setFleet = fleetHistory.setState;
  const [restoredAt, setRestoredAt] = useState(bootstrap.restoredAt);
```

(Replace the existing `const fleetHistory = useFleetHistory(newFleet());` line.)

- [ ] **Step 4: Implement debounced autosave (skip the first render)**

After `fleetResult` (~line 7969), add:

```jsx
  // Debounced autosave of the design (NOT the workbook). Skips the initial
  // render so an untouched pristine session never creates a save.
  const autosaveFirstRender = useRef(true);
  useEffect(() => {
    if (autosaveFirstRender.current) { autosaveFirstRender.current = false; return; }
    const id = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
          version: "vcf-sizer-v9", savedAt: new Date().toISOString(), fleet,
        }));
      } catch (e) { /* quota/serialization — best-effort, non-fatal */ }
    }, 750);
    return () => clearTimeout(id);
  }, [fleet]);

  // Flush the latest design to localStorage on tab close, covering the debounce
  // window. No "unsaved changes" prompt — autosave makes it redundant.
  useEffect(() => {
    const flush = () => {
      if (autosaveFirstRender.current) return; // never-edited session
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
          version: "vcf-sizer-v9", savedAt: new Date().toISOString(), fleet,
        }));
      } catch (e) { /* best-effort */ }
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [fleet]);
```

- [ ] **Step 5: Implement the restore banner**

In the header chrome (near the existing `autoImportedNotice` banner — grep for `autoImportedNotice` in the render to mirror its placement/markup), add:

```jsx
  {restoredAt && (
    <div className="flex items-center justify-between gap-3 bg-sky-50 border border-sky-200 rounded px-3 py-1.5 mb-2">
      <span className="text-[11px] text-sky-800 font-mono">
        Restored your previous design{typeof restoredAt === "string" ? ` (saved ${new Date(restoredAt).toLocaleString()})` : ""}.
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { setFleet(newFleet()); try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {} autosaveFirstRender.current = true; setRestoredAt(null); }}
          className="text-[10px] uppercase tracking-wider font-mono text-sky-700 border border-sky-300 hover:border-sky-500 rounded px-2 py-0.5"
        >Start fresh</button>
        <button type="button" aria-label="Dismiss" onClick={() => setRestoredAt(null)}
          className="text-sky-400 hover:text-sky-700 text-sm leading-none">&times;</button>
      </div>
    </div>
  )}
```

Note: "Start fresh" sets `autosaveFirstRender.current = true` so the subsequent `setFleet(newFleet())` doesn't immediately re-autosave the pristine fleet (it was just cleared).

- [ ] **Step 6: Run — must PASS** (`npx vitest run tests/unit/components/autosave.test.jsx`). Then `npm run build-html && npm run verify-html`; `npx vitest run tests/unit/components`.

- [ ] **Step 7: Commit**

```
git add vcf-design-studio-v9.jsx vcf-design-studio-v9.html tests/unit/components/autosave.test.jsx
git commit -m "feat(pre-launch): localStorage autosave + restore banner for the design"
```

---

## Task 3: Error boundary (#1)

**Files:** Modify `vcf-design-studio-v9.jsx` (ErrorBoundary class + export), `scripts/build-html.mjs` (mount line); Test `tests/unit/components/error-boundary.test.jsx`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/error-boundary.test.jsx`:

```jsx
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
  it("renders its children normally when they don't throw", () => {
    render(<ErrorBoundary><div>ok-content</div></ErrorBoundary>);
    expect(screen.getByText("ok-content")).toBeInTheDocument();
  });
  it("renders a recovery fallback (not a blank page) when a child throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // silence React's error log
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reload/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — must FAIL** (`ErrorBoundary` not exported).

- [ ] **Step 3: Implement the ErrorBoundary class**

In `vcf-design-studio-v9.jsx`, add near the other top-level components (e.g. above `function CapabilityTray`). React error boundaries must be class components:

```jsx
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { console.error("[VCF Studio] render error:", error, info); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md bg-white border border-slate-200 rounded-lg p-6 text-center">
          <h1 className="font-serif text-xl text-slate-900 mb-2">Something went wrong</h1>
          <p className="text-sm text-slate-600 mb-4">
            The studio hit an unexpected error. Your design is auto-saved in this browser —
            reloading will restore it.
          </p>
          <button type="button" onClick={() => window.location.reload()}
            className="text-xs uppercase tracking-wider font-mono text-white bg-blue-600 hover:bg-blue-700 rounded px-4 py-2">
            Reload
          </button>
        </div>
      </div>
    );
  }
}
```

Export it for tests where the other components are exported (find the `export { CapabilityTray }` line — or the export block — and add `ErrorBoundary`):

```jsx
export { CapabilityTray, ErrorBoundary };
```
(Match the existing export statement form; if `CapabilityTray` is exported on its own line, add an analogous `export { ErrorBoundary };`.)

- [ ] **Step 4: Wrap the mount in build-html.mjs**

In `scripts/build-html.mjs` find the mount string (`root.render(<VcfFleetSizer />);`) and change it to:

```js
root.render(<ErrorBoundary><VcfFleetSizer /></ErrorBoundary>);
```

`ErrorBoundary` is defined in the JSX that's inlined before the mount line, so it's in scope.

- [ ] **Step 5: Run — must PASS.** Then `npm run build-html && npm run verify-html` (confirm the regenerated HTML's mount line now wraps in `<ErrorBoundary>`). `npx vitest run tests/unit/components`.

- [ ] **Step 6: Commit**

```
git add vcf-design-studio-v9.jsx vcf-design-studio-v9.html scripts/build-html.mjs tests/unit/components/error-boundary.test.jsx
git commit -m "feat(pre-launch): top-level error boundary with recovery fallback"
```

---

## Task 4: Full suite + E2E (localStorage hygiene)

**Files:** possibly `tests/e2e/*.spec.ts` (clear localStorage), verification only otherwise.

- [ ] **Step 1:** `npm test` → all green (verify-html in sync, verify-cell-map clean, unit/migration/snapshot/invariants). The new component tests pass; existing snapshots unaffected (pristine sessions don't autosave or show the banner).
- [ ] **Step 2: E2E localStorage hygiene.** The autosave persists per-origin; a prior E2E run could leave a save that makes the next run show the restore banner. Ensure each Playwright test starts clean: add `await context.clearCookies()` is insufficient — add `await page.addInitScript(() => { try { localStorage.clear(); } catch {} })` (or `test.beforeEach` clearing storage) in the e2e specs that load the app, OR rely on Playwright's default fresh context per test (verify by running `npx playwright test` — if a "Restored your previous design" banner breaks an existing assertion, add the clear). Run `npx playwright test` → 28 green. If the privacy note or banner shifts a print/topology assertion, fix that assertion.
- [ ] **Step 3:** `npm run coverage` → engine.js gate held (these are JSX changes; engine.js coverage unaffected). 
- [ ] **Step 4 (optional E2E):** add one Playwright assertion that the privacy note text is visible on load, and that after editing + reload the design persists (autosave round-trip in a real browser). Skip if the unit coverage is deemed sufficient; document the choice.
- [ ] **Step 5: Commit** any E2E changes:

```
git add tests/e2e
git commit -m "test(pre-launch): clear localStorage in E2E + autosave/privacy smoke"
```

---

## Self-Review notes
- **Spec coverage:** §2 error boundary → Task 3; §3 persistence (autosave + restore banner + flush-on-unload) → Task 2; §4 privacy note → Task 1; §5 testing → all + Task 4.
- **Spec deviation (intentional):** the spec mentioned a native `beforeunload` "unsaved changes" prompt; the plan instead **flushes the autosave on `beforeunload`** (no prompt) — strictly better UX with reliable autosave (no nag, guarantees latest save). Noted here so it's a deliberate choice, not a gap.
- **Default-unchanged:** a never-edited session writes no autosave and shows no banner → existing snapshot/E2E behavior is preserved (modulo the always-present privacy note + the `<ErrorBoundary>` wrapper, which renders children transparently).
- **Naming consistency:** `vcf-studio:autosave` (`AUTOSAVE_KEY`), `restoredAt`, `ErrorBoundary` used identically across tasks.
