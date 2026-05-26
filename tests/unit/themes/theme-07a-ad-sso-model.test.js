// Theme 7a — fleet.adConfig model expansion.
//
// Adds the data model + UI + vault-policy entry for Active Directory
// bind credentials + Certificate Authority config (Microsoft +
// OpenSSL paths) + CSR subject. Workbook export (Configure Mgmt
// D34-D85) is deferred to theme 7b.
//
// Field set (createFleetAdConfig):
//   adFqdn, adUser, adPassword,             // vault — ad-bind
//   serviceAccountUser,
//   ca: {
//     type: "microsoft" | "openssl",
//     fqdn, url, user, password,            // ca.password is model-only today
//     templateName: "VMware",
//     algorithm: "RSA",
//     keySize: 4096,
//     csrSubject: { org, ou, country, state, locality, email }
//   }
//
// Acceptance:
//   - newFleet() carries default adConfig
//   - migrateFleet idempotent on legacy fleets (recursive whitelist-merge for nested ca/csrSubject)
//   - PASSWORD_POLICY["ad-bind"] exists with infrastructure-grade settings
//   - No regression in validatePlacementConstraints (adConfig is metadata-only)

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  migrateFleet,
  createFleetAdConfig,
  PASSWORD_POLICY,
  generatePassword,
  validatePlacementConstraints,
} = VcfEngine;

describe("Theme 7a — createFleetAdConfig factory", () => {
  it("returns the documented field set with safe defaults", () => {
    expect(createFleetAdConfig()).toEqual({
      adFqdn: "",
      adUser: "",
      adPassword: "",
      serviceAccountUser: "",
      ca: {
        type: "microsoft",
        fqdn: "",
        url: "",
        user: "",
        password: "",
        templateName: "VMware",
        algorithm: "RSA",
        keySize: 4096,
        csrSubject: {
          commonName: "",
          org: "",
          ou: "",
          country: "",
          state: "",
          locality: "",
          email: "",
        },
      },
    });
  });

  it("returns a fresh nested object on each call (no shared state)", () => {
    const a = createFleetAdConfig();
    const b = createFleetAdConfig();
    a.ca.csrSubject.org = "RainpoleA";
    a.ca.algorithm = "ECDSA";
    expect(b.ca.csrSubject.org).toBe("");
    expect(b.ca.algorithm).toBe("RSA");
    // ca and csrSubject objects are not shared references either.
    expect(a.ca).not.toBe(b.ca);
    expect(a.ca.csrSubject).not.toBe(b.ca.csrSubject);
  });
});

describe("Theme 7a — newFleet wires adConfig", () => {
  it("ships fleet.adConfig with factory defaults", () => {
    const f = newFleet();
    expect(f.adConfig).toEqual(createFleetAdConfig());
  });
});

describe("Theme 7a — migrateFleet backfill", () => {
  it("backfills adConfig on legacy fleets that lack it", () => {
    const raw = { ...newFleet(), version: "vcf-sizer-v9" };
    delete raw.adConfig;
    const migrated = migrateFleet(raw);
    expect(migrated.adConfig).toEqual(createFleetAdConfig());
  });

  it("preserves user-customized top-level fields on round-trip (idempotent)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.adConfig = {
      ...createFleetAdConfig(),
      adFqdn: "dc01.lab.local",
      adUser: "vcf-admin",
      adPassword: "preserved",
      serviceAccountUser: "svc-vcf",
    };
    const round1 = migrateFleet(f);
    const round2 = migrateFleet(round1);
    expect(round2.adConfig.adFqdn).toBe("dc01.lab.local");
    expect(round2.adConfig.adUser).toBe("vcf-admin");
    expect(round2.adConfig.adPassword).toBe("preserved");
    expect(round2.adConfig.serviceAccountUser).toBe("svc-vcf");
  });

  it("preserves nested ca + csrSubject customizations", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.adConfig = {
      ...createFleetAdConfig(),
      ca: {
        type: "openssl",
        fqdn: "ca.lab.local",
        url: "https://ca.lab.local/certsrv",
        user: "ca-admin",
        password: "ca-pw",
        templateName: "CustomTemplate",
        algorithm: "ECDSA",
        keySize: 3072,
        csrSubject: {
          org: "Rainpole",
          ou: "Engineering",
          country: "GB",
          state: "London",
          locality: "City of London",
          email: "ops@rainpole.io",
        },
      },
    };
    const migrated = migrateFleet(f);
    expect(migrated.adConfig.ca.type).toBe("openssl");
    expect(migrated.adConfig.ca.templateName).toBe("CustomTemplate");
    expect(migrated.adConfig.ca.algorithm).toBe("ECDSA");
    expect(migrated.adConfig.ca.keySize).toBe(3072);
    expect(migrated.adConfig.ca.csrSubject.org).toBe("Rainpole");
    expect(migrated.adConfig.ca.csrSubject.ou).toBe("Engineering");
    expect(migrated.adConfig.ca.csrSubject.country).toBe("GB");
    expect(migrated.adConfig.ca.csrSubject.email).toBe("ops@rainpole.io");
  });

  it("drops unknown keys at every nesting level (whitelist-merge)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.adConfig = {
      adFqdn: "dc.lab.local",
      bogusTop: "junk",
      ca: {
        type: "microsoft",
        templateName: "VMware",
        bogusCa: "junk",
        csrSubject: { org: "X", bogusCsr: "junk" },
      },
    };
    const migrated = migrateFleet(f);
    expect(migrated.adConfig).not.toHaveProperty("bogusTop");
    expect(migrated.adConfig.ca).not.toHaveProperty("bogusCa");
    expect(migrated.adConfig.ca.csrSubject).not.toHaveProperty("bogusCsr");
    // Customized fields preserved at every level.
    expect(migrated.adConfig.adFqdn).toBe("dc.lab.local");
    expect(migrated.adConfig.ca.templateName).toBe("VMware");
    expect(migrated.adConfig.ca.csrSubject.org).toBe("X");
    // Missing fields fall back to factory defaults.
    expect(migrated.adConfig.adUser).toBe("");
    expect(migrated.adConfig.ca.algorithm).toBe("RSA");
    expect(migrated.adConfig.ca.keySize).toBe(4096);
    expect(migrated.adConfig.ca.csrSubject.ou).toBe("");
  });

  it("handles a partial ca block (missing csrSubject) by backfilling defaults", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.adConfig = { ca: { type: "openssl", fqdn: "ca.x" } };
    const migrated = migrateFleet(f);
    expect(migrated.adConfig.ca.type).toBe("openssl");
    expect(migrated.adConfig.ca.fqdn).toBe("ca.x");
    // csrSubject backfilled to factory shape.
    expect(migrated.adConfig.ca.csrSubject).toEqual(createFleetAdConfig().ca.csrSubject);
  });

  it("handles non-object adConfig defensively", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.adConfig = "not-an-object";
    const migrated = migrateFleet(f);
    expect(migrated.adConfig).toEqual(createFleetAdConfig());
  });
});

describe("Theme 7a — PASSWORD_POLICY entry", () => {
  it("adds ad-bind entry with 20-char infrastructure-grade settings", () => {
    const p = PASSWORD_POLICY["ad-bind"];
    expect(p).toBeTruthy();
    expect(p.len).toBe(20);
    expect(p.classes).toEqual({ upper: 5, lower: 5, digit: 5, special: 5 });
    const sum = p.classes.upper + p.classes.lower + p.classes.digit + p.classes.special;
    expect(sum).toBe(p.len);
  });

  it("ad-bind shares the canonical infra-credential special alphabet", () => {
    const adBind = PASSWORD_POLICY["ad-bind"];
    const sddc = PASSWORD_POLICY["sddc-root"];
    expect(adBind.alphabet.special).toBe(sddc.alphabet.special);
  });

  it("generatePassword('ad-bind') yields a valid 20-char password", () => {
    const pw = generatePassword("ad-bind");
    expect(pw).toHaveLength(20);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[0-9]/);
    expect(pw).toMatch(/[^A-Za-z0-9]/);
  });

  it("generatePassword('ad-bind') produces unique values across calls", () => {
    const a = generatePassword("ad-bind");
    const b = generatePassword("ad-bind");
    expect(a).not.toBe(b);
  });
});

describe("Theme 7a — no regression on placement validator", () => {
  it("validatePlacementConstraints clean on a default newFleet", () => {
    const fleet = newFleet();
    const issues = validatePlacementConstraints(fleet);
    expect(Array.isArray(issues)).toBe(true);
    const criticals = issues.filter((i) => i.severity === "critical");
    expect(criticals).toEqual([]);
  });

  it("validatePlacementConstraints still clean after adConfig populated", () => {
    const fleet = newFleet();
    fleet.adConfig = {
      ...createFleetAdConfig(),
      adFqdn: "dc.example.com",
      adUser: "Administrator",
      ca: {
        ...createFleetAdConfig().ca,
        fqdn: "ca.example.com",
        url: "https://ca.example.com/certsrv",
        csrSubject: {
          org: "Org",
          ou: "OU",
          country: "US",
          state: "CA",
          locality: "Palo Alto",
          email: "admin@example.com",
        },
      },
    };
    const issues = validatePlacementConstraints(fleet);
    const criticals = issues.filter((i) => i.severity === "critical");
    expect(criticals).toEqual([]);
  });
});
