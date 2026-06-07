// @vitest-environment jsdom
//
// Ops Appliance Exclusion — UI component test (Task 6, Phase 3).
//
// Asserts that the editable appliance-stack panel (Management Appliance Stack)
// SHOWS the "VCF Operations" appliance row when fleet.vcfOpsEnabled is true
// (the default) and HIDES it when it is false.
//
// Strategy: render the full VcfFleetSizer app, locate the appliance-stack
// Section by its heading, then query within that section.  After toggling
// the fleet-level "ops" capability chip off (confirming the prompt), the
// StackPicker in that section should no longer render the "VCF Operations" row.
//
// Note: the deployment-profile preview (InstanceCard) renders `currentProfile.stack`
// (a DEPLOYMENT_PROFILES template), NOT cluster.infraStack — spec section 7
// scopes filtering to infraStack/sharedStack rows only.  The test is therefore
// scoped to the Section container, not the full document.
//
// The StackPicker renders each appliance using `def.label` from APPLIANCE_DB;
// the vcfOps entry has label "VCF Operations" — that is the text we query.

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VcfEngine from "../../../engine.js";

let VcfFleetSizer;

beforeAll(async () => {
  window.VcfEngine = VcfEngine;
  globalThis.XLSX = globalThis.XLSX || {
    read: () => ({}),
    write: () => "",
    utils: { sheet_to_json: () => [] },
  };
  const mod = await import("../../../vcf-design-studio-v9.jsx");
  VcfFleetSizer = mod.default;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper: find the Section container div that wraps the appliance-stack heading.
// Section renders:
//   <div class="mb-4">
//     <div ...>  ← header row
//       <h4 ...>{title}</h4>
//     </div>
//     {children}   ← StackPicker lives here
//   </div>
function getStackSection() {
  const heading = screen.queryByText("Management Appliance Stack");
  if (!heading) return null;
  // Walk up to the Section root div (class="mb-4")
  return heading.closest("div.mb-4") || heading.parentElement?.parentElement;
}

describe("Ops Appliance Exclusion — appliance-stack UI", () => {
  it("default fleet (Ops on): VCF Operations row is visible in the appliance-stack panel", () => {
    render(<VcfFleetSizer />);

    // The management appliance-stack section renders under the heading
    // "Management Appliance Stack".
    const section = getStackSection();
    expect(section).not.toBeNull();

    // The StackPicker renders each appliance row with def.label; vcfOps →
    // "VCF Operations".  Query within the section so we ignore unrelated
    // uses of the same label text elsewhere in the page.
    const opsRow = within(section).queryByText("VCF Operations");
    expect(opsRow).toBeInTheDocument();
  });

  it("Ops off: VCF Operations row is absent from the appliance-stack panel", async () => {
    const user = userEvent.setup();

    // hasData always returns true for ops, so clicking the chip triggers a
    // confirm().  Mock it to accept so the toggle proceeds.
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<VcfFleetSizer />);

    // The fleet-level CapabilityTray renders "Disable VCF Ops / Automation"
    // when the capability is on (defaults true).  Click it.
    const opsChips = screen.getAllByTitle("Disable VCF Ops / Automation");
    await user.click(opsChips[0]);

    // After toggling off, locate the section again (heading text unchanged —
    // isMgmtCluster is true for the default mgmt cluster).
    const section = getStackSection();
    expect(section).not.toBeNull();

    // The StackPicker inside the section must no longer render the vcfOps row.
    const opsRow = within(section).queryByText("VCF Operations");
    expect(opsRow).not.toBeInTheDocument();
  });
});
