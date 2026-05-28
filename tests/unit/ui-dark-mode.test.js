import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Structural regression guard for the dark-mode infrastructure. This PR
// ships the toggle + persistence + body backdrop. Per-panel `dark:`
// Tailwind variants on every surface are a follow-up; this test only
// pins the infrastructure pieces so a future refactor doesn't silently
// drop them.

const JSX_PATH = path.resolve(__dirname, "../../vcf-design-studio-v9.jsx");
const BUILDER_PATH = path.resolve(__dirname, "../../scripts/build-html.mjs");
const HTML_PATH = path.resolve(__dirname, "../../vcf-design-studio-v9.html");

describe("UI — dark mode infrastructure", () => {
  const jsx = fs.readFileSync(JSX_PATH, "utf8");
  const builder = fs.readFileSync(BUILDER_PATH, "utf8");
  const html = fs.readFileSync(HTML_PATH, "utf8");

  it("build-html configures Tailwind for class-based dark mode", () => {
    expect(builder).toMatch(/tailwind\.config = \{ darkMode: "class" \}/);
    expect(html).toMatch(/tailwind\.config = \{ darkMode: "class" \}/);
  });

  it("build-html runs an inline script BEFORE React that applies saved dark preference (no flash-of-light)", () => {
    // Reads localStorage and falls back to prefers-color-scheme.
    expect(builder).toMatch(/localStorage\.getItem\("vcf-studio-dark-mode"\)/);
    expect(builder).toMatch(/prefers-color-scheme: dark/);
    expect(builder).toMatch(/document\.documentElement\.classList\.add\("dark"\)/);
  });

  it("CSS sets dark body background + light-mode print fallback", () => {
    expect(builder).toMatch(/html\.dark body \{ background: #0f172a;/);
    // Print media forces light (dark PDF cover would be print-unfriendly).
    expect(builder).toMatch(/@media print[\s\S]+?html\.dark body \{ background: #ffffff/);
  });

  it("Editor wires darkMode state via useEffect that toggles the html class + localStorage", () => {
    expect(jsx).toMatch(/const \[darkMode, setDarkMode\] = useState/);
    expect(jsx).toMatch(/document\.documentElement\.classList\.add\("dark"\)/);
    expect(jsx).toMatch(/document\.documentElement\.classList\.remove\("dark"\)/);
    expect(jsx).toMatch(/localStorage\.setItem\("vcf-studio-dark-mode"/);
  });

  it("Toolbar exposes a Light/Dark toggle button with sun/moon glyphs", () => {
    expect(jsx).toMatch(/setDarkMode\(!darkMode\)/);
    expect(jsx).toMatch(/darkMode \? "☀ Light" : "🌙 Dark"/);
  });
});
