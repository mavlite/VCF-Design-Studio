import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  createFleetReportMetadata,
  newFleet,
  migrateFleet,
  migrateV5ToV6,
} = VcfEngine;

// ─────────────────────────────────────────────────────────────────────────────
// Plan 8a — fleet.reportMetadata
//
// Persisted client/project metadata for the PDF cover page. All fields
// default to empty strings; opt-in via the Fleet Summary UI panel. Must
// round-trip through Export JSON / Import JSON without loss, and existing
// fleets without the field migrate to the empty default.
// ─────────────────────────────────────────────────────────────────────────────

describe("createFleetReportMetadata factory", () => {
  it("returns the documented field set with empty-string defaults", () => {
    const m = createFleetReportMetadata();
    expect(m).toEqual({
      clientName: "",
      projectId: "",
      preparedBy: "",
      revision: "",
      documentDate: "",
    });
  });

  it("each call returns a fresh object (no shared mutation)", () => {
    const a = createFleetReportMetadata();
    const b = createFleetReportMetadata();
    a.clientName = "Acme";
    expect(b.clientName).toBe("");
  });
});

describe("newFleet includes reportMetadata", () => {
  it("seeds fleet.reportMetadata with empty defaults", () => {
    const f = newFleet();
    expect(f.reportMetadata).toEqual({
      clientName: "",
      projectId: "",
      preparedBy: "",
      revision: "",
      documentDate: "",
    });
  });
});

describe("migrateV5ToV6 backfills reportMetadata", () => {
  it("adds reportMetadata when missing from a legacy v5 shape", () => {
    const legacy = { instances: [] };
    const m = migrateV5ToV6(legacy);
    expect(m.reportMetadata).toBeDefined();
    expect(m.reportMetadata.clientName).toBe("");
  });

  it("preserves explicit reportMetadata values", () => {
    const fleet = {
      reportMetadata: {
        clientName: "Acme Corp",
        projectId: "VCF-2026-Q2",
        preparedBy: "J. Smith",
        revision: "Draft 2",
        documentDate: "2026-05-08",
      },
      instances: [],
    };
    const m = migrateV5ToV6(fleet);
    expect(m.reportMetadata.clientName).toBe("Acme Corp");
    expect(m.reportMetadata.projectId).toBe("VCF-2026-Q2");
    expect(m.reportMetadata.documentDate).toBe("2026-05-08");
  });
});

describe("migrateFleet final-pass backfill", () => {
  it("guarantees reportMetadata even on legacy callers that bypass V5→V6", () => {
    const legacy = { version: "vcf-sizer-v9", instances: [] };
    const m = migrateFleet(legacy);
    expect(m.reportMetadata).toEqual({
      clientName: "",
      projectId: "",
      preparedBy: "",
      revision: "",
      documentDate: "",
    });
  });

  it("preserves explicit reportMetadata on round-trip", () => {
    const fleet = newFleet();
    fleet.reportMetadata = {
      clientName: "Acme",
      projectId: "P-1",
      preparedBy: "JS",
      revision: "1.0",
      documentDate: "2026-05-08",
    };
    const once = migrateFleet({ version: "vcf-sizer-v9", fleet });
    expect(once.reportMetadata).toEqual(fleet.reportMetadata);
  });

  it("is idempotent (round-tripping preserves the explicit metadata)", () => {
    const fleet = newFleet();
    fleet.reportMetadata.clientName = "Acme";
    fleet.reportMetadata.preparedBy = "J. Smith";
    const once = migrateFleet({ version: "vcf-sizer-v9", fleet });
    const twice = migrateFleet({ version: "vcf-sizer-v9", fleet: once });
    expect(twice.reportMetadata).toEqual(once.reportMetadata);
  });
});

describe("JSON round-trip", () => {
  it("survives serialize → parse → migrate", () => {
    const fleet = newFleet();
    fleet.reportMetadata = {
      clientName: "Acme Corp",
      projectId: "VCF-2026-Q2",
      preparedBy: "J. Smith, SA",
      revision: "Draft 3",
      documentDate: "2026-05-08",
    };
    const exported = JSON.stringify({ version: "vcf-sizer-v9", fleet });
    const imported = JSON.parse(exported);
    const migrated = migrateFleet(imported);
    expect(migrated.reportMetadata).toEqual(fleet.reportMetadata);
  });
});

describe("schema isolation", () => {
  it("reportMetadata is independent of namingConfig (no cross-field bleed)", () => {
    const f = newFleet();
    f.reportMetadata.clientName = "Acme";
    f.namingConfig.prefix = "vcf";
    const migrated = migrateFleet({ version: "vcf-sizer-v9", fleet: f });
    expect(migrated.reportMetadata.clientName).toBe("Acme");
    expect(migrated.namingConfig.prefix).toBe("vcf");
    // No cross-pollination
    expect(migrated.reportMetadata.prefix).toBeUndefined();
    expect(migrated.namingConfig.clientName).toBeUndefined();
  });
});
