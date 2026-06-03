import { describe, it, expect } from "vitest";
import * as engine from "../../engine.js";
const { migrateFleet, newFleet } = engine;

describe("capability flag backfill in migrateFleet", () => {
  it("pristine import: optional caps off, ops on", () => {
    const f = newFleet();
    const cluster = f.instances[0].domains[0].clusters[0];
    delete cluster.edgeCluster.enabled;
    delete cluster.vpcConfig.enabled;
    delete f.vcfOpsEnabled;
    delete f.instances[0].drEnabled;
    const m = migrateFleet({ version: "vcf-sizer-v9", fleet: f });
    const mc = m.instances[0].domains[0].clusters[0];
    expect(mc.edgeCluster.enabled).toBe(false);
    expect(mc.vpcConfig.enabled).toBe(false);
    expect(m.vcfOpsEnabled).toBe(true);
    expect(m.instances[0].drEnabled).toBe(false);
  });

  it("backfills enabled:true when the object already has data", () => {
    const f = newFleet();
    const cluster = f.instances[0].domains[0].clusters[0];
    cluster.edgeCluster.name = "edge-01";
    delete cluster.edgeCluster.enabled;
    const m = migrateFleet({ version: "vcf-sizer-v9", fleet: f });
    expect(m.instances[0].domains[0].clusters[0].edgeCluster.enabled).toBe(true);
  });

  it("derives drEnabled from warm-standby posture", () => {
    const f = newFleet();
    f.instances[0].drPosture = "warm-standby";
    delete f.instances[0].drEnabled;
    const m = migrateFleet({ version: "vcf-sizer-v9", fleet: f });
    expect(m.instances[0].drEnabled).toBe(true);
  });
});
