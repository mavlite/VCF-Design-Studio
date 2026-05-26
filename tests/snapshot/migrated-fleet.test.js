import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import VcfEngine from "../../engine.js";
const { migrateFleet } = VcfEngine;

const FIXTURES = path.resolve(__dirname, "../../test-fixtures/v5");
const SNAPSHOTS = path.resolve(__dirname, "../../test-fixtures/snapshots/migrated");

// fixtures.test.js intentionally drops `fleet` and `instance` from its
// sizing snapshots — they round-trip the input verbatim and would
// bloat the snapshot without adding signal about derived values.
//
// That leaves a gap: model fields added by newer themes (witnessConfig,
// supervisorConfig, az2HostOverlay, vsanCompute, federationConfig,
// mgmtClusterSddcId, networks.*.ipv6, etc.) could be silently deleted
// from migrateFleet's output by a refactor and no snapshot would fail.
//
// This file snapshots the *new model surface* the recent themes added
// — the per-cluster + per-instance + fleet-level config sub-objects
// shipped tonight. Captures the canonical migrated shape for every v5
// fixture so accidental field drops trip the snapshot diff.

if (!fs.existsSync(SNAPSHOTS)) fs.mkdirSync(SNAPSHOTS, { recursive: true });

const v5Files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  if (typeof value === "number" && !Number.isInteger(value)) {
    return Math.round(value * 1e6) / 1e6;
  }
  return value;
}

// Project the migrated fleet onto the recent-themes model surface.
// Keeping the projection narrow (vs snapshotting the whole fleet)
// keeps diffs readable when one specific block churns and surfaces
// new-field drift loudly.
function projectModelSurface(fleet) {
  return {
    networkConfig: fleet.networkConfig,
    namingConfig: fleet.namingConfig,
    installerConfig: fleet.installerConfig,
    backupConfig: fleet.backupConfig,
    adConfig: fleet.adConfig,
    federationConfig: fleet.federationConfig,
    instances: (fleet.instances || []).map((inst) => ({
      id: inst.id,
      name: inst.name,
      witnessEnabled: inst.witnessEnabled,
      witnessConfig: inst.witnessConfig,
      mgmtClusterSddcId: inst.mgmtClusterSddcId,
      domains: (inst.domains || []).map((d) => ({
        id: d.id,
        type: d.type,
        clusters: (d.clusters || []).map((c) => ({
          id: c.id,
          name: c.name,
          tiering: c.tiering,
          advanced: c.advanced,
          edgeCluster: c.edgeCluster,
          az2HostOverlay: c.az2HostOverlay,
          vsanCompute: c.vsanCompute,
          supervisorConfig: c.supervisorConfig,
          // Networks: only the recent-theme additions (ipv6 + dualStackIpv6)
          networks: c.networks && {
            dualStackIpv6: c.networks.dualStackIpv6,
            mgmt: c.networks.mgmt && { ipv6: c.networks.mgmt.ipv6 },
            vmotion: c.networks.vmotion && { ipv6: c.networks.vmotion.ipv6 },
            vsan: c.networks.vsan && { ipv6: c.networks.vsan.ipv6 },
            hostTep: c.networks.hostTep && { ipv6: c.networks.hostTep.ipv6 },
            edgeTep: c.networks.edgeTep && { ipv6: c.networks.edgeTep.ipv6 },
          },
        })),
      })),
    })),
  };
}

describe("snapshot — migrated fleet model surface stability", () => {
  it.each(v5Files)("migrated model surface for %s matches snapshot", async (file) => {
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8"));
    const fleet = migrateFleet(raw);
    const surface = canonicalize(projectModelSurface(fleet));
    const snapPath = path.join(SNAPSHOTS, file.replace(/\.json$/, ".surface.snap.json"));
    await expect(JSON.stringify(surface, null, 2) + "\n").toMatchFileSnapshot(snapPath);
  });
});
