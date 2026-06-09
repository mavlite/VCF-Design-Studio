# Production Build Pipeline — Design

**Date:** 2026-06-09
**Status:** Spec (scoped; decisions confirmed). Covers item #2 from the pre-launch review. Items #1/#3/#4 are in `2026-06-09-pre-launch-resilience-and-trust-design.md`.

## 1. Problem / Goal

The shipped `vcf-design-studio-v9.html` transpiles ~25k lines of JSX **in the browser on every load** via Babel-standalone (~3 MB download + parse/compile), and styles via the **Tailwind Play CDN** (which Tailwind explicitly states is *not for production* — it does JIT compilation in-browser, adds weight, and can't be SRI-pinned). Consequences: slow first paint (worst on mobile/slow links), a large payload, and a CSP forced to allow `'unsafe-eval'` and `'unsafe-inline'`.

Goal: produce a **pre-compiled, single-file** production artifact that loads fast, ships no in-browser compiler, self-hosts its dependencies, and runs under a strict CSP — **without** disturbing the build-free local-dev workflow.

### Decisions (confirmed)
- **Single self-contained HTML** (inline compiled JS + inline purged CSS) — preserves the offline / `file://` portability and "one file to ship" story.
- Keep the existing build-free dev HTML; the production artifact is a **separate** output.

### Non-goals
- No bundler-served multi-file app, no dev server, no SPA router.
- Don't change the engine/JSX source or app behavior — this is a build/packaging change only.
- Don't break `npm run build-html` (the dev, build-free path) or `verify-html-sync`.

## 2. Architecture

Add a `build-html:prod` mode (a sibling to the dev `build-html`) that emits `dist/index.html`:

1. **Transpile JSX → plain JS** with **esbuild** (already present transitively via `@vitejs/plugin-react` / vitest — `require.resolve('esbuild')` succeeds). One `esbuild.transform`/`build` over `vcf-design-studio-v9.jsx` (JSX loader, target es2020, minify) producing plain JS that runs without Babel. The same source transforms the dev path applies (strip `import`, rewrite engine refs to `window.VcfEngine`, strip `export default`) happen before/within the transpile.
2. **Compile a static, purged Tailwind CSS** with the Tailwind CLI (new devDep `tailwindcss`). A minimal `tailwind.config` with `content: ["vcf-design-studio-v9.jsx"]` (+ a small `safelist` for any classes assembled dynamically — see §4) → a purged stylesheet containing only the classes actually used. Inlined as a `<style>` block, replacing the `cdn.tailwindcss.com` script.
3. **Self-host React + ReactDOM** by inlining the already-vendored `react.production.min.js` + `react-dom.production.min.js` from `node_modules` (replacing the unpkg `<script>` tags). SheetJS is already inlined. Result: **no `unpkg.com` / `cdn.tailwindcss.com` dependency at all** — the only external is Google Fonts (kept; optionally self-hosted as a follow-up).
4. **Drop Babel-standalone** entirely (the `@babel/standalone` `<script>` and the `type="text/babel"` block). The app JS becomes a plain inline `<script type="module">`.
5. **Strict CSP via build-time hashes.** After assembly, compute the SHA-256 of each inline `<script>` and `<style>` block and emit a CSP that uses `'sha256-…'` sources — dropping **both** `'unsafe-eval'` (Babel gone) and `'unsafe-inline'` (hashes instead). React attaches event listeners via JS (no inline HTML handlers), so strict script-src works. Resulting CSP (prod):
   ```
   default-src 'self';
   script-src 'self' 'sha256-<engine>' 'sha256-<sheetjs>' 'sha256-<react>' 'sha256-<reactdom>' 'sha256-<app>';
   style-src 'self' 'sha256-<tailwind>' https://fonts.googleapis.com;
   font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:;
   connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'
   ```
   (Google Fonts kept under style-src/font-src; self-hosting them → fully `'self'` is an optional follow-up.)

`dist/index.html` is the published artifact. The dev `vcf-design-studio-v9.html` is unchanged.

## 3. Build wiring

- `package.json`: add `"build-html:prod": "node scripts/build-html-prod.mjs"`; add `tailwindcss` to devDependencies; add `dist/` to `.gitignore` (build output — not committed; produced at publish time).
- `scripts/build-html-prod.mjs`: reuses the dev script's source-transform helpers (refactor the shared `import`/engine/`export` rewrites in `build-html.mjs` into exported helpers so both modes share them — DRY). Steps: transform+esbuild the JSX, run the Tailwind CLI to a temp CSS, read the vendored React/ReactDOM/SheetJS, assemble the HTML with inline blocks, compute hashes, inject the CSP, write `dist/index.html`.
- The dev `build-html` path is refactored only to **share** the source-transform helpers — its output stays byte-identical (verify-html-sync still passes).

## 4. Risks & mitigations

- **Tailwind purge completeness:** Tailwind's content scanner needs full class strings present in source. The codebase mostly uses complete literals (e.g. `bg-teal-600`), which purge keeps; the few `"base " + (cond ? "bg-teal-600 …" : "bg-white …")` concatenations still contain complete literals → safe. **Mitigation:** a `safelist` (or regex) for any color/utility assembled from fragments, plus a **visual/automated check** that the prod artifact renders styled (the prod E2E in §5 catches a broken stylesheet). Audit for any truly computed class names (e.g. `` `bg-${color}-600` ``) — if found, safelist them.
- **CSP hash byte-stability:** hashes are computed over the exact inline bytes post-assembly; esbuild/Tailwind output is deterministic for a given input, so hashes are reproducible. The build computes them last, so they always match.
- **Dev/prod drift:** both outputs derive from the same engine.js + JSX via shared helpers; a `verify-html-prod` (parallel to verify-html-sync) re-builds `dist/index.html` and asserts it matches a freshly generated one would be **build-output churn** — instead, dist/ is gitignored and reproducible, and CI builds it fresh. The guard is the prod E2E.

## 5. Testing

- **Reproducibility/unit:** a test that `build-html-prod` produces a `dist/index.html` containing inline compiled JS (no `type="text/babel"`, no `babel`/`unpkg`/`cdn.tailwindcss.com` references), an inline `<style>` (no Tailwind CDN), and a CSP with `sha256-` sources and **no** `unsafe-eval`/`unsafe-inline`.
- **Prod E2E (validates what ships):** point a Playwright spec at `dist/index.html` — it must render the shell, import a fixture, and run a key flow (e.g. toggle a capability / export JSON) with **no CSP violations** in the console (assert `page.on('console')`/CSP-violation events are empty). This is the real proof the compiled, strict-CSP artifact works.
- **Size/perf sanity:** assert `dist/index.html` is materially smaller than the dev HTML minus the ~3 MB Babel (informational).
- Existing suites unchanged: `npm test`, `verify-html-sync`, the dev E2E (still against the build-free HTML) all stay green — the dev path is untouched.

## 6. Out of scope / follow-ups
- Self-hosting Google Fonts (→ CSP fully `'self'`; small follow-up).
- A real minify/tree-shake of engine.js (esbuild can minify the inline app JS; engine.js could also be minified for prod — optional).
- Switching the dev E2E to also run against `dist/index.html` (once prod is the canonical artifact).
- A CI job that builds `dist/index.html` and publishes it (deployment is host-specific; out of scope for this spec).
