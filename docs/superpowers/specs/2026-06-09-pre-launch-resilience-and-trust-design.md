# Pre-launch Resilience & Trust — Design

**Date:** 2026-06-09
**Status:** Spec (scoped; decisions confirmed). Covers items #1 (error boundary), #3 (persistence / unsaved-work), #4 (privacy note) from the pre-launch review. Item #2 (production build pipeline) is a separate spec.

## 1. Problem / Goal

The VCF Design Studio is a static, client-only single-page app (no backend). It's secure and well-tested, but three runtime/UX gaps remain before publishing publicly:
- **No error boundary** → an uncaught render error blanks the whole page, and since designs live only in memory, the user's work is lost.
- **No persistence** → a reload, crash, or accidental tab-close loses unsaved work (Export JSON is the only save, and it's manual).
- **No trust signal** → users entering infra designs and generating credentials have no in-app confirmation that nothing is uploaded.

Goal: make the app fail gracefully, never silently lose work, and visibly state its client-only privacy posture.

### Non-goals
- No backend, accounts, or server-side storage (the app stays client-only).
- Not persisting the loaded **workbook blob** (1–2 MB base64 busts storage quotas — a deliberate prior decision). Only the design JSON (the `fleet` object) is persisted.
- No telemetry/analytics (the app makes zero outbound calls; that stays true).

## 2. #1 — Error boundary

A single `class ErrorBoundary extends React.Component` (React error boundaries must be class components; the app is otherwise function components). `getDerivedStateFromError` flips to a fallback; `componentDidCatch` logs to `console.error` (no network).

- **Placement:** wrap the app at the mount point. `scripts/build-html.mjs` emits `root.render(<VcfFleetSizer />)` (~line 72); change to `root.render(<ErrorBoundary><VcfFleetSizer /></ErrorBoundary>)`. The `ErrorBoundary` class is defined in `vcf-design-studio-v9.jsx` and exported (for tests) the same way `CapabilityTray` is.
- **Fallback UI:** a centered card in the studio style — heading "Something went wrong", a short line, a **Reload** button (`location.reload()`), and (paired with #3) "Your design was auto-saved — reloading will restore it." If #3 ships together, the fallback is genuinely reassuring; if not, it says "your last Export JSON is your backup."
- The boundary cannot read the crashed tree's state, so it cannot offer an in-place Export — recovery is via reload + the autosave (#3).

**Files:** `vcf-design-studio-v9.jsx` (ErrorBoundary + export), `scripts/build-html.mjs` (mount line), HTML regen. **Test:** JSDOM — a child that throws renders the fallback (not a blank container); the Reload button is present.

## 3. #3 — Persistence / unsaved-work (auto-restore + dismissible banner)

Persist the `fleet` object (the design — small JSON, NOT the workbook) to `localStorage`, debounced; restore it on load through `migrateFleet` (so an older stored shape upgrades cleanly); warn on unload when there are unsaved changes.

### Mechanics
- **Save:** a small effect in `VcfFleetSizer` watches `fleet` and writes `localStorage["vcf-studio:autosave"] = JSON.stringify({ version: "vcf-sizer-v9", savedAt: <ISO>, fleet })`, debounced ~750 ms. Wrapped in try/catch (quota/serialization failures are non-fatal — autosave is best-effort). Skip writing the pristine default `newFleet()` (don't create a save for an untouched session).
- **Restore (auto + banner):** on mount, read the key; if present and parseable, run it through `migrateFleet` and initialize `useFleetHistory` with the restored fleet **instead of** `newFleet()`, and set a `restoredFromAutosave` flag. Render a **dismissible banner**: *"Restored your previous design (saved <relative time>). [Start fresh]"*. "Start fresh" → `setFleet(newFleet())`, clear the autosave key, hide the banner. Dismiss (×) → hide the banner, keep the restored design. The banner only appears when a save was actually restored.
- **beforeunload guard:** add a `beforeunload` listener that calls `preventDefault()` (triggering the browser's native "leave site?" prompt) only when the in-memory fleet differs from the last-exported/last-saved state — i.e. there are unsaved edits. With autosave this is a secondary safety net (covers the moment between an edit and the debounced save, and signals "you have unsaved work"). The listener is removed on unmount.
- **Interaction with import/new:** importing a design or clicking "New" updates `fleet` → autosave overwrites the key naturally (no special handling). "Start fresh" explicitly clears the key.

### Design choices
- **Key namespacing:** `vcf-studio:autosave` (single slot — one in-progress design; matches the single-fleet model). Versioned payload so a future format change can be detected/migrated or discarded.
- **Quota:** the fleet JSON is small (KBs); localStorage's ~5 MB is ample. The rejected sessionStorage idea was about the multi-MB workbook, which is NOT stored here.
- **Privacy:** localStorage is same-origin and never transmitted — consistent with the client-only posture (and reinforced by #4).

**Files:** `vcf-design-studio-v9.jsx` (a `useAutosave`/persistence hook + the banner UI + beforeunload), tests. **Tests (JSDOM):** save writes the key (debounced/flushed); a seeded key restores on mount + shows the banner; "Start fresh" clears the key + resets to default; a malformed/old key is migrated or safely ignored (no crash); beforeunload fires only when dirty.

## 4. #4 — Privacy / trust note

A single muted line in the app chrome (header subtitle or a slim footer): *"All processing happens in your browser — your design and any generated passwords are never uploaded."* Styled with the existing micro-label utility (`text-[10px] uppercase tracking-[0.14em] text-slate-400` or similar muted treatment). It is literally accurate (verified: `connect-src 'self'`, zero `fetch`/XHR in source). **Files:** `vcf-design-studio-v9.jsx` (one element near the header/footer), HTML regen. **Test:** the text renders.

## 5. Testing & build

- All three are JSX/runtime changes → after edits, `npm run build-html` + `npm run verify-html` must pass; `npm test` green; new JSDOM component tests as above.
- Default-behavior preservation: a session that never edits (pristine `newFleet()`) writes no autosave and shows no banner — so existing E2E/snapshot behavior is unchanged. Confirm the E2E smoke (which loads the app fresh) still passes (no banner on first visit; clear `localStorage` between E2E runs).

## 6. Out of scope / follow-ups
- Multiple named saves / a "designs library" (single autosave slot is enough for v1).
- Self-hosting Google Fonts (tracked under the #2 build-pipeline spec).
- Cross-tab autosave sync (BroadcastChannel) — unnecessary for a single-design tool.
