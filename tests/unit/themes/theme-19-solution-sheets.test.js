import { describe, it } from "vitest";

// Theme 19 — WONTFIX
//
// The pristine workbooks carry ~18 solution sheets (Site Protection &
// DR, On-Premises Ransomware Recovery, Cyber Recovery [9.1-new],
// Private AI Ready Infrastructure, Cloud-Based Ransomware Recovery,
// Cross Cloud Mobility / HCX, Arkham, Active Directory Inputs,
// Identity & Access Manager, etc.).
//
// The studio's scope is fleet topology + sizing + workbook stamp for
// the five core sheets (Deploy/Configure Mgmt, Deploy/Configure WLD,
// Deploy Cluster). Solution overlays are upstream of the studio's
// concerns and would require dedicated data models per add-on.
//
// Decision: do not model. Re-open per-solution scoped PRs if/when a
// specific solution (e.g. HCX-only, AD-only) becomes a target.

describe.todo("Theme 19 — WONTFIX, solution sheets out of scope (TRACKING)");
