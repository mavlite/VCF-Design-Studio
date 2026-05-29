# Brainstorm Session — Environment Scan Import

**Date:** 2026-05-29
**Status:** Design captured; **not yet implemented**. Preserved on branch `feat/environment-scan-import` to revisit later.
**Spec:** [`docs/superpowers/specs/2026-05-29-environment-scan-import-design.md`](../specs/2026-05-29-environment-scan-import-design.md)
**Mockups:** saved under `.superpowers/brainstorm/1906-1780080898/content/` (gitignored) — `import-flow-options.html`, `import-flow-v2.html`, `review-step.html`.

## The idea (as posed)

Scan/gather data from a customer's existing VMware vSphere / VCF environment and, using that raw data + the VCF Design Studio, automatically produce a recommended update/install path and a design based on their existing infrastructure. The brief was explicitly *"investigate how difficult this would be."*

## Key context discovered

The studio's model **already represents existing infrastructure** — `deploymentPathway` (greenfield/expand/**converge**/**brownfield**), `domain.imported`, `cluster.preExisting`, version migration (`migrate9_0To9_1`, `reconcileFleetVersion`), the sizing engine (`sizeFleet`, `recommendVcenterSize`/`recommendNsxSize`), validation rules, and workbook export. So the **target-design half already exists**. The gap is the **input** half: collect current state → map into the fleet model → (later) recommend.

## Decisions made (Q&A)

| Question | Decision | Why |
|---|---|---|
| How is data collected? | **Customer-run read-only PowerCLI collector** → emits versioned JSON → uploaded like the existing workbook import | No backend, no inbound network access, no credential custody; whole pipeline stays **client-side**. Big de-risk + selling point ("data never leaves your browser"). |
| Source environment scope (first slice)? | **Standalone vSphere → VCF** (not existing-VCF → newer-VCF) | Maps cleanly to converge/brownfield pathways; most common consulting case; most tractable recommendation logic. Existing-VCF upgrade-path needs a curated Broadcom version/BOM knowledge base — deferred. |
| Output / automation level? | **Seed a design + readiness report, consultant-refined** (human in the loop) | Fits the studio (a consultant tool); avoids confidently-wrong full automation. |
| UI entry + flow shape? | **Guided wizard** (option "C") off a new `Import Environment Scan` header button | More hand-holding for an occasional, multi-stage task; gives the collector hand-off its own step. |
| Review-step layout? | **Cluster-role table** (option "1") | The core decision is "what VCF role does each cluster play" — a scannable grid (Management / Workload / Skip per row) makes it explicit and scales to many clusters. |
| Styling | Match the studio: white panels, thin slate borders, monospace micro-labels (uppercase, wide tracking), serif titles, accent-on-hover; reuse the Compare Fleet modal pattern | First mockups were too "generic SaaS"; restyled to the studio's editorial/technical look. |

## Feasibility verdict

**Moderate effort, low architectural risk, clearly worth doing.** It rides the existing engine + import pattern; the new work concentrates in: (1) the PowerCLI collector + its versioned output schema, (2) the collector→fleet mapping heuristics (messy real topology → VCF-shaped model — never 100% automatic, hence consultant-refined), and (3) later, the VCF 9 readiness rule set.

## Phasing

- **Phase 0** — collector output JSON schema (defined in the spec) + minimal read-only PowerCLI collector.
- **Phase 1 (spec'd)** — ingest scan → current-state fleet + the wizard UI; load into the editor. *Outcome: a scan becomes a pre-populated design a consultant can work and export.*
- **Phase 2 (roadmap)** — auto-seed a recommended VCF 9 *target* design from current state.
- **Phase 3 (roadmap)** — readiness/gap report (coarse hardware-fit + "what's missing for VCF 9").

## Open questions (to resolve before implementation)

1. **Load behavior** — spec'd as **replace** the current fleet (greenfield, like workbook import) with a confirmation. Confirm vs. offering merge / add-as-instance.
2. **Collector hardening scope** — Phase 1 tests ingest from committed fixtures; the reference PowerCLI script ships alongside but its field-by-field robustness across vSphere versions is ongoing. Confirm that's acceptable for a first cut.
3. **`fleet.sourceEnvironment`** — a small additive model field for provenance (vCenter version, collectedAt). Confirm acceptable.

## Resume pointer

Design is at the **spec-review gate**. To pick this up later: re-read the spec, resolve the three open questions, then run `superpowers:writing-plans` to produce the implementation plan (Phase 1), and execute. The branch `feat/environment-scan-import` holds the spec + this session record.
