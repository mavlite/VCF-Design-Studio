import { describe, it, expect } from "vitest";
import { stampSentinels, sentinelFor } from "../helpers/sentinel-walk.js";

describe("sentinel-walk", () => {
  it("stamps string leaves with a unique path token", () => {
    const { stamped, sentinels } = stampSentinels({ a: "x", b: { c: "y" } });
    expect(stamped.a).toBe("rt::a");
    expect(stamped.b.c).toBe("rt::b.c");
    expect(sentinels).toEqual({ a: "rt::a", "b.c": "rt::b.c" });
  });

  it("gives distinct in-range values to vlan-like numeric leaves", () => {
    const s1 = sentinelFor("networks.vmotion.vlan", 100);
    const s2 = sentinelFor("networks.vsan.vlan", 100);
    expect(s1).not.toBe(s2);
    expect(s1).toBeGreaterThanOrEqual(2);
    expect(s1).toBeLessThanOrEqual(4094);
  });

  it("gives distinct valid IPs to ip-shaped string leaves", () => {
    const ip = sentinelFor("networks.mgmt.gateway", "10.0.0.1");
    expect(ip).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
    expect(ip).not.toBe("10.0.0.1");
  });

  it("gives distinct valid CIDRs to cidr-shaped string leaves", () => {
    const cidr = sentinelFor("networks.mgmt.subnet", "10.0.0.0/24");
    expect(cidr).toMatch(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/);
  });

  it("preserves array structure and indexes paths", () => {
    const { stamped, sentinels } = stampSentinels({ xs: [{ n: "a" }, { n: "b" }] });
    expect(stamped.xs[1].n).toBe("rt::xs.1.n");
    expect(sentinels["xs.1.n"]).toBe("rt::xs.1.n");
  });

  it("leaves null/undefined leaves untouched and out of sentinels", () => {
    const { stamped, sentinels } = stampSentinels({ a: null, b: undefined });
    expect(stamped.a).toBeNull();
    expect(sentinels).toEqual({});
  });
});
