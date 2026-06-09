// Shared E2E fixture: clear localStorage before every navigation.
//
// The app autosaves the design to localStorage (pre-launch resilience feature).
// Served over file://, localStorage has an opaque/shared origin that Playwright
// does NOT isolate per BrowserContext — so one spec's fleet edit would leak a
// restorable design into the next spec, breaking "fresh default fleet"
// assumptions. Specs that expect a clean slate import `test`/`expect` from here
// instead of "@playwright/test". (autosave-and-trust.spec.ts intentionally
// tests persistence across reload and keeps the plain @playwright/test import.)
import { test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
    await use(page);
  },
});

export { expect } from "@playwright/test";
