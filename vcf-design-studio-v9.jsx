// ─────────────────────────────────────────────────────────────────────────────
// VCF Design Studio — v9
// Hierarchical design system: Fleet → Sites → VCF Instances → Domains → Clusters
// 
// What's new in v3:
//   • Five-level hierarchy (was: flat mgmt + wlds list)
//   • Per-cluster host specs (each cluster has its own hardware profile)
//   • Topology diagram view (auto-generated SVG, second tab)
//   • Backward-compatible JSON import (v2 flat format auto-migrates)
//
// Sizing math is unchanged in shape — it now runs at the cluster level and 
// rolls up through domain → instance → site → fleet via simple aggregation.
//
// Provenance: every appliance number traces to the official Broadcom 
// "VMware Cloud Foundation 9.0 Planning and Preparation Workbook", except VKS
// Supervisor sizing which traces to techdocs.broadcom.com (the workbook does
// not include VKS sizing tables).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, useRef, memo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Engine symbols live in engine.js and are loaded before this module.
// At runtime they’re attached to window.VcfEngine by the <script> tag in
// vcf-design-studio-v9.html. Tests import engine.js directly via require().
// ─────────────────────────────────────────────────────────────────────────────
const {
  APPLIANCE_DB, placementOptionsFor, DEPLOYMENT_PROFILES, DEPLOYMENT_PATHWAYS, SIZING_LIMITS,
  POLICIES, TB_TO_TIB,
  VLAN_ID_MIN, VLAN_ID_MAX,
  MTU_MGMT, MTU_VMOTION, MTU_VSAN, MTU_TEP_MIN, MTU_TEP_RECOMMENDED,
  DEFAULT_BGP_ASN_AA, TEP_POOL_GROWTH_FACTOR,
  // Plan 12 — VCF version support (resolver + migration + reconcile layers).
  DEFAULT_VCF_VERSION_LEGACY, DEFAULT_VCF_VERSION_NEW, SUPPORTED_VCF_VERSIONS,
  applianceSize, applianceAvailableIn, availableAppliances, profileStack,
  migrate9_0To9_1, migrate9_1To9_0,
  reconcileFleetVersion, reconcileInstanceVersion,
  NIC_PROFILES,
  recommendVcenterSize, recommendNsxSize,
  cryptoKey,
  newMgmtCluster, newWorkloadCluster,
  newWorkloadDomain, newInstance, newSite, newFleet,
  ensurePlacement, getHostSplitPct, stackForInstance, promoteToInitial,
  SSO_MODES, ssoInstancesPerBroker, SSO_INSTANCES_PER_BROKER_LIMIT,
  DR_POSTURES, DR_REPLICATED_COMPONENTS, DR_BACKUP_COMPONENTS,
  T0_HA_MODES, newT0Gateway, validateT0Gateways, validatePlacementConstraints,
  EDGE_DEPLOYMENT_MODELS,
   migrateFleet, migrateV5ToV6,
   stackTotals, applianceEntryDisk, minHostsForVerdict, sizeFleet,
   createFleetNetworkConfig, createClusterNetworks, createHostIpOverride,
   allocateClusterIps, validateNetworkDesign,
   emitInstallerJson, emitWorkbookRows,
   // Plan 11 — workbook cell-map export
   emitWorkbookCellMapCsv, workbookVersionForFleet,
   // Plan 7 — naming convention helpers
   createFleetNamingConfig, createClusterNaming, createFleetReportMetadata,
   resolveHostname, resolveVdsName, applyVdsTemplate,
} = (typeof window !== "undefined" ? window.VcfEngine : require("./engine.js"));


function PerSiteView({ fleet, fleetResult }) {
  // Shared Appliances rows — each instance's sharedStack listed once,
  // NOT attributed to either site. A 3-node NSX Manager cluster across two
  // sites is not "1.5 managers per site." Locked decision in the v5 brief.
  const sharedRows = useMemo(() => {
    return (fleetResult.instanceResults || []).map((ir) => {
      // Build a lookup of domain id → domain name so rows carry a friendly
      // owner label. Entries without ownerDomainId are instance-level
      // (mgmt deployment profile, pre-v5.2 exports, etc.) and render as
      // "(instance)".
      const domNameById = {};
      for (const d of ir.instance.domains || []) domNameById[d.id] = d.name;

      const rawItems = (ir.sharedStack || [])
        .filter((entry) => entry.instances > 0)
        .map((entry) => {
          const def = APPLIANCE_DB[entry.id];
          const sz = applianceSize(def, entry.size, fleet?.vcfVersion);
          const ownerLabel = entry.ownerDomainId
            ? (domNameById[entry.ownerDomainId] || "(unknown)")
            : "(instance)";
          const ownerKind = entry.ownerDomainId ? "wld" : "instance";
          return {
            key: entry.key || `${entry.id}-${entry.size}-${entry.ownerDomainId || "inst"}`,
            label: def?.label || entry.id,
            size: entry.size,
            instances: entry.instances,
            vcpu: (sz?.vcpu || 0) * entry.instances,
            ram: (sz?.ram || 0) * entry.instances,
            disk: (sz?.disk || 0) * entry.instances,
            ownerLabel,
            ownerKind,
          };
        });
      // Sort instance-level rows first, then per-WLD rows grouped by owner.
      const items = rawItems.sort((a, b) => {
        if (a.ownerKind !== b.ownerKind) return a.ownerKind === "instance" ? -1 : 1;
        if (a.ownerLabel !== b.ownerLabel) return a.ownerLabel.localeCompare(b.ownerLabel);
        return a.label.localeCompare(b.label);
      });
      return { instance: ir.instance, items, witness: ir.witness, totals: ir.sharedTotals };
    });
    // Dep narrowed from [fleetResult] to [fleetResult.instanceResults] — the
    // Shared Appliances table only depends on per-instance shared stacks, so
    // edits to siteResults/totalHosts don't need to re-derive rows.
  }, [fleetResult.instanceResults]);

  return (
    <div className="space-y-5">
      {/* Shared Appliances — stretched stacks NOT split per site */}
      <div className="border border-amber-200 bg-white rounded-lg p-5">
        <div className="flex items-baseline justify-between border-b border-amber-200 pb-2 mb-4">
          <h2 className="font-serif text-2xl text-slate-900">Shared Appliances</h2>
          <span className="text-[10px] uppercase tracking-[0.2em] text-amber-700 font-mono">
            One stack per VCF instance · not attributed to either site
          </span>
        </div>
        <p className="text-[11px] text-slate-500 font-mono mb-4 leading-relaxed">
          A stretched VCF instance has ONE management plane (SDDC Manager, NSX Manager
          cluster, VCF Operations cluster, etc.) — not one per site. These appliances are
          listed here once per instance, not split by host-split percentage.
        </p>
        {sharedRows.length === 0 && (
          <p className="text-[11px] text-slate-400 font-mono">No instances yet.</p>
        )}
        {sharedRows.map(({ instance, items, witness, totals }) => (
          <div key={instance.id} className="border border-slate-200 rounded p-3 mb-3 last:mb-0">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm font-serif text-slate-800 font-semibold">{instance.name}</span>
              <span className="text-[10px] text-slate-500 font-mono">
                {fmt(totals.vcpu)} vCPU · {fmt(totals.ram)} GB RAM · {fmt(totals.disk)} GB disk
              </span>
            </div>
            {items.length === 0 && !witness ? (
              <p className="text-[10px] text-slate-400 font-mono">No appliances configured.</p>
            ) : (
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                    <th className="text-left font-normal pb-1.5 pl-1">Appliance</th>
                    <th className="text-left font-normal pb-1.5">Size</th>
                    <th className="text-right font-normal pb-1.5 px-3">Count</th>
                    <th className="text-right font-normal pb-1.5 px-3">vCPU</th>
                    <th className="text-right font-normal pb-1.5 px-3">RAM (GB)</th>
                    <th className="text-right font-normal pb-1.5 px-3">Disk (GB)</th>
                    <th className="text-left font-normal pb-1.5 pl-3">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.key} className="border-t border-slate-100">
                      <td className="py-1.5 pl-1 text-slate-700">{row.label}</td>
                      <td className="py-1.5 text-slate-500">{row.size}</td>
                      <td className="py-1.5 px-3 text-right text-slate-800 tabular-nums">×{row.instances}</td>
                      <td className="py-1.5 px-3 text-right text-slate-600 tabular-nums">{fmt(row.vcpu)}</td>
                      <td className="py-1.5 px-3 text-right text-slate-600 tabular-nums">{fmt(row.ram)}</td>
                      <td className="py-1.5 px-3 text-right text-slate-600 tabular-nums">{fmt(row.disk)}</td>
                      <td className={`py-1.5 pl-3 ${row.ownerKind === "wld" ? "text-sky-700" : "text-slate-400"}`}>
                        {row.ownerKind === "wld" ? `@ ${row.ownerLabel}` : row.ownerLabel}
                      </td>
                    </tr>
                  ))}
                  {witness && (
                    <tr className="border-t border-slate-100 bg-yellow-50">
                      <td className="py-1.5 pl-1 text-yellow-800">
                        vSAN Witness Host
                        <span className="text-[9px] text-yellow-700 ml-2">
                          @ {instance.witnessSite?.name || "Witness Site"}
                        </span>
                      </td>
                      <td className="py-1.5 text-yellow-700">{witness.size}</td>
                      <td className="py-1.5 px-3 text-right text-yellow-800 tabular-nums">×{witness.instances}</td>
                      <td className="py-1.5 px-3 text-right text-yellow-700 tabular-nums">{fmt(witness.vcpu)}</td>
                      <td className="py-1.5 px-3 text-right text-yellow-700 tabular-nums">{fmt(witness.ram)}</td>
                      <td className="py-1.5 px-3 text-right text-yellow-700 tabular-nums">{fmt(witness.disk)}</td>
                      <td className="py-1.5 pl-3 text-yellow-700">(witness)</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>

      {/* Per-Site Resource Allocation */}
      <div className="border border-blue-200 bg-white rounded-lg p-5">
        <div className="flex items-baseline justify-between border-b border-blue-200 pb-2 mb-4">
          <h2 className="font-serif text-2xl text-slate-900">Per-Site Resource Allocation</h2>
          <span className="text-[10px] uppercase tracking-[0.2em] text-blue-600 font-mono">
            Physical host placement · Accounts for stretched cluster splits
          </span>
        </div>
        <p className="text-[11px] text-slate-500 font-mono mb-5 leading-relaxed">
          Shows how many ESXi hosts are physically located at each site. Stretched domains
          split their host count across sites based on each domain's host-split percentage.
          Local domains contribute all their hosts to their home site. Shared appliances
          (SDDC Manager, NSX Manager, VCF Ops) appear in the panel above, not here.
        </p>

        {(fleetResult.siteResults || []).length === 0 && (
          <p className="text-[11px] text-slate-400 font-mono">
            No sites yet. Add sites and instances on the Editor tab to populate this view.
          </p>
        )}

        {(fleetResult.siteResults || []).map((sr, srIdx, allSrs) => {
          // Skip projections that contributed no domains at this site (e.g.
          // an instance touching the site but with every domain pinned to
          // the other site via localSiteId).
          const visibleProjections = sr.projections.filter(
            (p) => p.projectedDomains.length > 0
          );
          let siteHosts = 0;
          let siteRawTib = 0;
          for (const p of visibleProjections) {
            for (const pd of p.projectedDomains) {
              for (const pc of pd.projectedClusters) {
                siteHosts += pc.hostsHere || 0;
                siteRawTib += pc.rawTibHere || 0;
              }
            }
          }

          // Failover rollup for THIS site: walk every stretched cluster this
          // site participates in and bucket each by verdict. "This site"
          // here means "the survivor if the other site fails". Each
          // stretched domain carries its own 2-site pair in dom.stretchSiteIds,
          // so the verdict lookup is resolved per-domain: if this site is
          // the pair's stretchSiteIds[0] we read siteA, if it's [1] we read
          // siteB. A single VCF instance can touch 3+ sites with different
          // pairs per domain — iterating domains (not instances) keeps the
          // rollup correct.
          const foRollup = { green: 0, yellow: 0, red: 0, reds: [], yellows: [], total: 0, otherSites: new Set() };
          for (const ir of fleetResult.instanceResults || []) {
            const inst = ir.instance;
            if (!inst.siteIds || !inst.siteIds.includes(sr.site.id)) continue;
            inst.domains.forEach((dom, dIdx) => {
              if (dom.placement !== "stretched") return;
              const pair = Array.isArray(dom.stretchSiteIds) ? dom.stretchSiteIds : null;
              if (!pair || pair.length !== 2) return;
              const idxHere = pair.indexOf(sr.site.id);
              if (idxHere < 0) return; // this site isn't part of THIS domain's pair
              const otherId = pair[1 - idxHere];
              const otherName = fleet.sites.find((s) => s.id === otherId)?.name || "other site";
              foRollup.otherSites.add(otherName);
              const dr = ir.domainResults[dIdx];
              if (!dr) return;
              dom.clusters.forEach((clu, cIdx) => {
                const cr = dr.clusterResults[cIdx];
                if (!cr || !cr.failover) return;
                const side = idxHere === 0 ? cr.failover.siteA : cr.failover.siteB;
                foRollup.total++;
                foRollup[side.verdict]++;
                if (side.verdict === "red") foRollup.reds.push({ dom, clu, side });
                if (side.verdict === "yellow") foRollup.yellows.push({ dom, clu, side });
              });
            });
          }
          const worstVerdict =
            foRollup.total === 0 ? null
            : foRollup.red > 0 ? "red"
            : foRollup.yellow > 0 ? "yellow"
            : "green";
          const otherNames = [...foRollup.otherSites].join(" / ");
          const foColor =
            worstVerdict === "green"  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
            : worstVerdict === "yellow" ? "border-amber-300 bg-amber-50 text-amber-800"
            : worstVerdict === "red"    ? "border-rose-300 bg-rose-50 text-rose-800"
            : "";
          const foSymbol =
            worstVerdict === "green" ? "✓"
            : worstVerdict === "yellow" ? "⚠"
            : worstVerdict === "red" ? "✕" : "";

          // VCF-TOPO-004 region grouping: emit a region header when the
          // current region differs from the previous site's region. Sites
          // without a region fall under "(ungrouped)". Headers are only
          // shown when any site declares a non-empty region — single-region
          // fleets keep the flat layout.
          const anyRegion = allSrs.some((x) => (x.site?.region || "").trim());
          const currentRegion = (sr.site?.region || "").trim() || "(ungrouped)";
          const prevRegion = srIdx > 0
            ? ((allSrs[srIdx - 1].site?.region || "").trim() || "(ungrouped)")
            : null;
          const regionHeader = (anyRegion && currentRegion !== prevRegion) ? (
            <div className="mt-4 mb-2 text-[10px] uppercase tracking-[0.2em] text-slate-400 font-mono border-b border-slate-200 pb-1">
              Region: {currentRegion}
            </div>
          ) : null;

          return (
            <React.Fragment key={sr.site.id}>
              {regionHeader}
            <div className="border border-slate-200 rounded-lg p-4 mb-4 bg-white">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-lg font-serif text-slate-900">
                    {sr.site.name}
                    {sr.site.siteRole && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-400 font-mono border border-slate-200 rounded px-1.5 py-0.5">
                        {sr.site.siteRole}
                      </span>
                    )}
                  </h3>
                  {sr.site.location && (
                    <span className="text-sm text-slate-500">{sr.site.location}</span>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-2xl font-mono text-slate-900 font-semibold">
                    {siteHosts} <span className="text-sm text-slate-400">hosts</span>
                  </div>
                  <div className="text-sm font-mono text-slate-500">
                    {fmt(siteRawTib, 1)} TiB raw vSAN
                  </div>
                </div>
              </div>

              {foRollup.total > 0 && (
                <div className={`border rounded p-2.5 mb-3 ${foColor}`}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-[11px] uppercase tracking-wider font-mono font-semibold">
                      {foSymbol} If {otherNames} fails, {sr.site.name} alone can run:
                    </span>
                    <span className="text-[10px] font-mono">
                      {foRollup.green}/{foRollup.total} fully · {foRollup.yellow} degraded · {foRollup.red} unable
                    </span>
                  </div>
                  {foRollup.red > 0 && (
                    <ul className="text-[10px] font-mono mt-1 space-y-0.5">
                      {foRollup.reds.map(({ dom, clu, side }, i) => (
                        <li key={`r-${i}`}>
                          ✕ <strong>{dom.name} / {clu.name}</strong>: {side.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                  {foRollup.red === 0 && foRollup.yellow > 0 && (
                    <ul className="text-[10px] font-mono mt-1 space-y-0.5">
                      {foRollup.yellows.map(({ dom, clu, side }, i) => (
                        <li key={`y-${i}`}>
                          ⚠ <strong>{dom.name} / {clu.name}</strong>: {side.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {visibleProjections.length === 0 ? (
                <p className="text-[11px] text-slate-400 font-mono py-2">
                  No instances assigned to this site.
                </p>
              ) : (
                visibleProjections.map((p) => {
                  const otherSite = p.otherSiteId ? fleet.sites.find((s) => s.id === p.otherSiteId) : null;
                  return (
                    <div key={p.instance.id} className="border-l-2 border-sky-300 pl-3 mb-3 last:mb-0">
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-sm font-serif text-slate-800 font-semibold">{p.instance.name}</span>
                        {otherSite && (
                          <span className="text-[10px] text-blue-600 font-mono">
                            ↔ Stretched with {otherSite.name}
                          </span>
                        )}
                      </div>
                      <table className="w-full text-xs font-mono">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                            <th className="text-left font-normal pb-1.5 pl-1">Domain · Cluster</th>
                            <th className="text-center font-normal pb-1.5">Placement</th>
                            <th className="text-right font-normal pb-1.5 px-3">Hosts Here</th>
                            <th className="text-right font-normal pb-1.5 px-3">Raw TiB Here</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.projectedDomains.flatMap((pd) =>
                            pd.projectedClusters.map((pc) => {
                              const isStretchedDom =
                                pd.domain.placement === "stretched"
                                && Array.isArray(pd.domain.stretchSiteIds)
                                && pd.domain.stretchSiteIds.length === 2;
                              return (
                                <tr key={pc.cluster.id} className="border-t border-slate-100">
                                  <td className="py-1.5 pl-1 text-slate-700">
                                    {pd.domain.name} <span className="text-slate-400">·</span> {pc.cluster.name}
                                  </td>
                                  <td className="py-1.5 text-center">
                                    {isStretchedDom ? (
                                      <span className="text-[9px] uppercase tracking-wider text-blue-600 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
                                        ↔ Stretched · {pd.sharePct}% here
                                      </span>
                                    ) : (
                                      <span className="text-[9px] uppercase tracking-wider text-slate-400 bg-slate-50 border border-slate-200 rounded px-2 py-0.5">
                                        Local
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-1.5 px-3 text-right text-slate-800 font-semibold tabular-nums">
                                    {pc.hostsHere}
                                  </td>
                                  <td className="py-1.5 px-3 text-right text-slate-600 tabular-nums">
                                    {fmt(pc.rawTibHere, 1)}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  );
                })
              )}
            </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UI PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (n, d = 0) =>
  n === undefined || n === null || Number.isNaN(n)
    ? "—"
    : Number(n).toLocaleString(undefined, {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });

function NumField({ label, value, onChange, step = 1, min = 0, suffix }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1 font-medium">
        {label}
      </span>
      <div className="relative">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className={`w-full bg-white border border-slate-200 rounded py-1.5 text-slate-800 font-mono text-sm focus:outline-none focus:border-blue-500 focus:bg-white ${suffix ? "pl-2.5 pr-12" : "px-2.5"}`}
        />
        {suffix && (
          <span className="absolute right-7 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-mono pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1 font-medium">
        {label}
      </span>
      <input
        type="text"
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-slate-800 font-mono text-sm focus:outline-none focus:border-blue-500"
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1 font-medium">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-slate-800 font-mono text-sm focus:outline-none focus:border-blue-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Section({ title, children, right }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between border-b border-slate-200 pb-1.5 mb-3">
        <h4 className="text-[11px] uppercase tracking-[0.18em] text-blue-700 font-semibold">
          {title}
        </h4>
        {right}
      </div>
      {children}
    </div>
  );
}

// Row / FloorRow / Stat accept only primitive props (strings, numbers, bools),
// so memo's default shallow comparison is sufficient to skip re-renders when
// an unrelated sibling cluster changes. Parents still re-render but these
// leaves no-op if their own props are unchanged.
const Row = memo(function Row({ k, v }) {
  return (
    <div className="flex justify-between border-b border-dotted border-slate-200 py-0.5">
      <span className="text-slate-400">{k}</span>
      <span className="text-slate-700">{v}</span>
    </div>
  );
});

const FloorRow = memo(function FloorRow({ label, value, active }) {
  return (
    <div
      className={`flex justify-between px-2 py-1 rounded border ${
        active
          ? "border-blue-400 bg-blue-50 text-blue-800"
          : "border-slate-200 text-slate-500"
      }`}
    >
      <span className="uppercase tracking-wider text-[10px]">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
});

const Stat = memo(function Stat({ label, value, mono }) {
  return (
    <div className="border border-slate-200 bg-white rounded p-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400 mb-1 font-mono">
        {label}
      </div>
      <div className={`text-xl text-slate-900 ${mono ? "font-mono" : "font-serif"}`}>
        {value}
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// STACK PICKER — table of appliance entries with size/instance controls
// ─────────────────────────────────────────────────────────────────────────────
function StackPicker({
  stack,
  onChange,
  isMgmtCluster,
  defaultInstancesById,
  allowedPlacements,
  // Plan 1 + Plan 2: per-entry cluster pin. When mgmtClusters/wldClusters
  // are provided, renders an inline cluster selector on each row whose
  // appliance is `per-domain` placement, with options gated by the
  // appliance's placementConstraint and the owning domain's imported flag.
  // Examples:
  //   - vCenter / NSX Manager / Avi Controller in a greenfield WLD →
  //     only mgmtClusters offered (VCF-INV-003).
  //   - NSX Edge in any pathway → mgmt + wld both offered (flexible).
  //   - Same appliances in an imported (brownfield) WLD → both offered.
  mgmtClusters,
  wldClusters,
  isImportedDomain,
  domainDefaultClusterId,
  // Plan 12 — VCF version. Filters the "add appliance" menu so 9.1-only
  // appliances (VCFMS) don't appear in 9.0 fleets. Defaults to 9.0 for
  // safety when a parent forgot to pass it. Engine threading (sizing math
  // using vcfVersion) lands in PR 2.
  vcfVersion = DEFAULT_VCF_VERSION_LEGACY,
}) {
  const updateItem = (idx, patch) => {
    onChange(stack.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };
  const removeItem = (idx) => onChange(stack.filter((_, i) => i !== idx));
  const addItem = (componentId) => {
    const def = APPLIANCE_DB[componentId];
    if (!def) return;
    // HA-aware default: if the parent passed a per-appliance instance-count
    // map (derived from the instance's deployment profile), honor it.
    // Otherwise fall back to 1.
    const defaultInstances = defaultInstancesById?.[componentId] ?? 1;
    onChange([
      ...stack,
      { id: componentId, size: def.defaultSize, instances: defaultInstances, key: cryptoKey() },
    ]);
  };

  const usedIds = new Set(stack.map((s) => s.id));
  // Plan 12 — gate by VCF version first (hides VCFMS in 9.0, etc.), then by
  // the usual filters. availableAppliances() walks APPLIANCE_DB and respects
  // each def's `availableInVersions`.
  const availableToAdd = Object.entries(availableAppliances(vcfVersion)).filter(([id, def]) => {
    if (usedIds.has(id)) return false;
    // When a parent scope restricts what can be added (e.g., WLD Components
    // only allows per-domain appliances), filter the menu accordingly.
    if (allowedPlacements && !allowedPlacements.includes(def.placement)) return false;
    return true;
  });
  const totals = stackTotals(stack, vcfVersion);

  // VKS Supervisor info block — shown when supervisor is in the stack
  const hasVks = stack.some((s) => s.id === "vksSupervisor");
  const vksItem = stack.find((s) => s.id === "vksSupervisor");

  return (
    <div>
      {hasVks && vksItem && (
        <div className="mb-3 border border-sky-300 bg-sky-50 rounded p-3">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-sky-700 font-mono font-semibold">
              VKS Deployment Mode
            </span>
            <span className="text-[10px] text-sky-600 font-mono">
              {vksItem.instances === 1 ? "Simple (1 VM) — Single Mgmt Zone or non-HA" :
               vksItem.instances === 3 ? "High Availability (3 VMs) — Required for 3-zone, recommended for production" :
               `Custom: ${vksItem.instances} VMs`}
            </span>
          </div>
          <p className="text-[10px] text-slate-500 font-mono leading-relaxed">
            {APPLIANCE_DB.vksSupervisor.info}
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono" style={{ minWidth: "640px" }}>
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-400">
              <th className="text-left font-normal pb-1.5 pl-1" style={{ width: "22%" }}>Component</th>
              <th className="text-left font-normal pb-1.5" style={{ width: "28%" }}>Size</th>
              <th className="text-right font-normal pb-1.5 px-3" style={{ width: "8%" }}>Inst</th>
              <th className="text-right font-normal pb-1.5 px-3" style={{ width: "10%" }}>vCPU</th>
              <th className="text-right font-normal pb-1.5 px-3" style={{ width: "12%" }}>RAM (GB)</th>
              <th className="text-right font-normal pb-1.5 px-3" style={{ width: "14%" }}>Disk (GB)</th>
              <th className="pb-1.5" style={{ width: "6%" }}></th>
            </tr>
          </thead>
          <tbody>
            {stack.map((item, idx) => {
              const def = APPLIANCE_DB[item.id];
              if (!def) return null;
              const sz = applianceSize(def, item.size, vcfVersion) || applianceSize(def, def.defaultSize, vcfVersion);
              return (
                <tr key={item.key || idx} className="border-t border-slate-200">
                  <td className="py-2 pl-1 text-slate-700">
                    <div title={def.source} className="flex items-center gap-1.5 flex-wrap">
                      <span>{def.label}</span>
                      {def.recommendedScope === "wld" && (
                        <span
                          className="text-[9px] uppercase tracking-wider text-amber-700 font-mono bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
                          title="VCF architectural convention: this appliance is typically deployed in the workload domain it serves, not the management cluster. Still movable."
                        >
                          ⚑ typ-in-WLD
                        </span>
                      )}
                      {def.dualRole && (
                        <select
                          value={item.role || (isMgmtCluster ? "mgmt" : "wld")}
                          onChange={(e) => updateItem(idx, { role: e.target.value })}
                          className="text-[9px] uppercase tracking-wider font-mono bg-white border border-slate-200 rounded px-1 py-0.5 text-slate-700"
                          title={`VCF-APP-002/003 and VCF-APP-004/005: declare whether this ${def.label} instance serves the management plane or a workload domain. Drives placement/sharing invariants.`}
                        >
                          <option value="mgmt">role: mgmt</option>
                          <option value="wld">role: wld</option>
                        </select>
                      )}
                      {(mgmtClusters || wldClusters) && def.placement === "per-domain" && (() => {
                        const opts = placementOptionsFor(item.id, {
                          isImportedDomain: !!isImportedDomain,
                          mgmtClusters: mgmtClusters || [],
                          wldClusters: wldClusters || [],
                        });
                        if (opts.length === 0) return null;
                        const tooltip =
                          def.placementConstraint === "flexible"
                            ? "Flexible placement (VCF-APP-006). NSX Edge can run on either a mgmt-domain cluster or a workload-domain cluster — choose based on traffic patterns."
                            : def.placementConstraint === "mgmt-only-greenfield"
                              ? "Per VCF-INV-003, this appliance must run on a management-domain cluster for greenfield workload domains. Mark the domain as Imported (brownfield) in the header to unlock workload-domain placement for pre-existing VMs."
                              : "Override the domain default placement for this appliance.";
                        return (
                          <select
                            value={item.placementClusterId || ""}
                            onChange={(e) =>
                              updateItem(idx, {
                                placementClusterId: e.target.value || null,
                              })
                            }
                            className="text-[9px] font-mono bg-white border border-slate-200 rounded px-1 py-0.5 text-slate-700"
                            title={tooltip}
                          >
                            <option value="">📍 default</option>
                            {opts.map((o) => (
                              <option key={o.id} value={o.id}>
                                📍 [{o.scope}] {o.label}
                              </option>
                            ))}
                          </select>
                        );
                      })()}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap items-center gap-1">
                      {def.fixed ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <select
                          value={item.size}
                          onChange={(e) => updateItem(idx, { size: e.target.value })}
                          className="bg-white border border-slate-200 rounded px-2 py-1 text-slate-800 text-[11px] w-full max-w-[220px]"
                        >
                          {Object.keys(def.sizes).map((k) => {
                            const lim = SIZING_LIMITS[item.id]?.[k];
                            return (
                              <option key={k} value={k}>
                                {lim ? `${k} — ${lim.label}` : k}
                              </option>
                            );
                          })}
                        </select>
                      )}
                      {def.storageProfiles && def.storageProfiles.length > 1 && (
                        <select
                          value={item.storageProfile || def.defaultStorageProfile || "default"}
                          onChange={(e) => updateItem(idx, { storageProfile: e.target.value })}
                          className="bg-white border border-slate-200 rounded px-2 py-1 text-slate-800 text-[11px]"
                          title={`Storage profile (VCF ${vcfVersion} P&P Workbook). Default / Large / X-Large vary disk allocation independently of the compute size. Currently selected: ${(item.storageProfile || def.defaultStorageProfile || "default")}.`}
                        >
                          {def.storageProfiles.map((p) => (
                            <option key={p} value={p}>storage: {p}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      min={0}
                      value={item.instances}
                      onChange={(e) => updateItem(idx, { instances: parseInt(e.target.value) || 0 })}
                      className="w-14 bg-white border border-slate-200 rounded px-2 py-1 text-slate-800 text-[11px] text-right"
                    />
                  </td>
                  <td className="py-2 px-3 text-right text-slate-600 tabular-nums">{fmt(sz.vcpu * item.instances)}</td>
                  <td className="py-2 px-3 text-right text-slate-600 tabular-nums">{fmt(sz.ram * item.instances, sz.ram < 1 ? 2 : 0)}</td>
                  <td className="py-2 px-3 text-right text-slate-600 tabular-nums">{fmt(applianceEntryDisk(item, def, sz) * item.instances)}</td>
                  <td className="py-2 text-right pr-2">
                    <button
                      onClick={() => removeItem(idx)}
                      className="text-slate-400 hover:text-rose-600 text-sm px-1"
                      aria-label="Remove"
                    >×</button>
                  </td>
                </tr>
              );
            })}
            {stack.length > 0 && (
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td colSpan={3} className="py-2 pl-1 text-[10px] uppercase tracking-wider text-blue-700">Stack Total</td>
                <td className="py-2 px-3 text-right text-blue-800 tabular-nums">{fmt(totals.vcpu)}</td>
                <td className="py-2 px-3 text-right text-blue-800 tabular-nums">{fmt(totals.ram, 0)}</td>
                <td className="py-2 px-3 text-right text-blue-800 tabular-nums">{fmt(totals.disk)}</td>
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {availableToAdd.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 self-center mr-1">Add:</span>
          {availableToAdd.map(([id, def]) => (
            <button
              key={id}
              onClick={() => addItem(id)}
              className="text-[10px] font-mono uppercase tracking-wider text-slate-500 hover:text-blue-600 border border-slate-200 hover:border-blue-400 rounded px-2 py-0.5 transition-colors"
            >
              + {def.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIZE RECOMMENDER — auto-selects vCenter and NSX Manager from target scale
// ─────────────────────────────────────────────────────────────────────────────
function SizeRecommender({ stack, onChange }) {
  const [hosts, setHosts] = useState(100);
  const [vms, setVms] = useState(1000);
  const [clusters, setClusters] = useState(5);

  const suggestedVcenter = recommendVcenterSize(hosts, vms);
  const suggestedNsx = recommendNsxSize(hosts, clusters);

  const apply = () => {
    onChange(stack.map((item) => {
      if (item.id === "vcenter") return { ...item, size: suggestedVcenter };
      if (item.id === "nsxMgr") return { ...item, size: suggestedNsx };
      return item;
    }));
  };

  return (
    <div className="border border-slate-200 bg-slate-50 rounded p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono">
          Auto-size from target scale
        </span>
        <span className="text-[9px] uppercase tracking-wider text-slate-400 font-mono">
          Derived from P&P Workbook scale tables
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 items-end">
        <NumField label="Target Hosts"  value={hosts}    onChange={setHosts} />
        <NumField label="Target VMs"    value={vms}      onChange={setVms} />
        <NumField label="NSX Clusters"  value={clusters} onChange={setClusters} />
        <button
          onClick={apply}
          className="h-[34px] text-[10px] uppercase tracking-wider font-mono text-blue-600 border border-blue-300 hover:bg-blue-50 rounded px-3"
        >
          Apply → {suggestedVcenter} / {suggestedNsx}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLUSTER CARD — leaf-level editor where the sizing math actually happens
// ─────────────────────────────────────────────────────────────────────────────
function ClusterCard({ cluster, onChange, onRemove, canRemove, result, isMgmtCluster, injectedEntries, failoverSiteNames, domainHostSplitPct, fleet, instance, domain }) {
  const update = (patch) => onChange({ ...cluster, ...patch });
  const updateHost = (patch) => onChange({ ...cluster, host: { ...cluster.host, ...patch } });
  const updateWorkload = (patch) => onChange({ ...cluster, workload: { ...cluster.workload, ...patch } });
  const updateStorage = (patch) => onChange({ ...cluster, storage: { ...cluster.storage, ...patch } });
  const updateTiering = (patch) => onChange({ ...cluster, tiering: { ...cluster.tiering, ...patch } });
  const t0s = cluster.t0Gateways || [];
  const addT0 = () => onChange({ ...cluster, t0Gateways: [...t0s, newT0Gateway(`t0-${t0s.length + 1}`)] });
  const updateT0 = (idx, patch) => onChange({ ...cluster, t0Gateways: t0s.map((t, i) => i === idx ? { ...t, ...patch } : t) });
  const removeT0 = (idx) => onChange({ ...cluster, t0Gateways: t0s.filter((_, i) => i !== idx) });
  const toggleT0Edge = (idx, key) => {
    const t0 = t0s[idx];
    const nextKeys = (t0.edgeNodeKeys || []).includes(key)
      ? t0.edgeNodeKeys.filter((k) => k !== key)
      : [...(t0.edgeNodeKeys || []), key];
    updateT0(idx, { edgeNodeKeys: nextKeys });
  };
  const edgeEntries = (cluster.infraStack || []).filter((e) => e.id === "nsxEdge" && e.key);
  const t0Issues = validateT0Gateways(cluster);

  const limiterColor = {
    Compute: "text-sky-700",
    Memory: "text-violet-600",
    Storage: "text-blue-600",
    Policy: "text-rose-600",
    Manual: "text-emerald-700",
  }[result.limiter];

  return (
    <div className="border border-emerald-300 bg-white rounded-md p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-[0.18em] text-emerald-700 font-mono">
            ◆ Cluster
          </span>
          <input
            value={cluster.name}
            onChange={(e) => update({ name: e.target.value })}
            className="bg-transparent text-base text-slate-800 font-serif border-none focus:outline-none focus:bg-slate-50 rounded px-1"
          />
          {cluster.isDefault && (
            <span className="text-[9px] uppercase tracking-wider text-slate-400 font-mono border border-slate-200 rounded px-1.5 py-0.5">
              Default
            </span>
          )}
          {cluster.preExisting && (
            <span
              className="text-[9px] uppercase tracking-wider text-stone-600 font-mono border border-stone-300 bg-stone-50 rounded px-1.5 py-0.5"
              title="VCF-PATH-003: this cluster pre-existed and is being converged into the VCF fleet rather than deployed fresh."
            >
              ≋ Existing
            </span>
          )}
          <label
            className="text-[9px] uppercase tracking-wider text-slate-400 font-mono cursor-pointer flex items-center gap-1"
            title="Mark this cluster as pre-existing (converge pathway). The sizing engine still computes resources, but the cluster is flagged as brownfield for capex/reporting."
          >
            <input
              type="checkbox"
              checked={!!cluster.preExisting}
              onChange={(e) => update({ preExisting: e.target.checked })}
              className="accent-stone-500"
            />
            pre-existing
          </label>
          {result.failover && (() => {
            // Compact header badge summarizing the stretched-cluster
            // failover verdict. Full detail is rendered lower in the card
            // and in PerSiteView. This exists so the user can see the
            // rollup while editing a cluster.
            const fo = result.failover;
            const aName = failoverSiteNames?.[0] || "Site A";
            const bName = failoverSiteNames?.[1] || "Site B";
            // Worst verdict wins for the badge color.
            const order = { green: 0, yellow: 1, red: 2 };
            const worst = order[fo.siteA.verdict] >= order[fo.siteB.verdict] ? fo.siteA : fo.siteB;
            const colorClass =
              worst.verdict === "green"  ? "text-emerald-700 bg-emerald-50 border-emerald-300"
              : worst.verdict === "yellow" ? "text-amber-700 bg-amber-50 border-amber-300"
              : "text-rose-700 bg-rose-50 border-rose-300";
            const symbol = worst.verdict === "green" ? "✓" : worst.verdict === "yellow" ? "⚠" : "✕";
            const label = worst.verdict === "green"
              ? "Site failover OK"
              : worst.verdict === "yellow"
                ? "Site failover degraded"
                : "Site failover unsafe";
            const tooltip =
              `${aName} alone: ${fo.siteA.verdict.toUpperCase()} — ${fo.siteA.reason}\n` +
              `${bName} alone: ${fo.siteB.verdict.toUpperCase()} — ${fo.siteB.reason}`;
            return (
              <span
                className={`text-[9px] uppercase tracking-wider font-mono border rounded px-1.5 py-0.5 ${colorClass}`}
                title={tooltip}
              >
                {symbol} {label}
              </span>
            );
          })()}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-slate-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={cluster.storage.externalStorage}
              onChange={(e) => updateStorage({ externalStorage: e.target.checked })}
              className="accent-blue-600"
            />
            EXT STORAGE
          </label>
          {canRemove && (
            <button
              onClick={onRemove}
              className="text-slate-400 hover:text-rose-600 text-xs px-2 py-0.5 border border-slate-200 rounded"
            >
              REMOVE
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* LEFT: inputs */}
        <div>
          <Section title="Host Specification">
            <div className="grid grid-cols-2 gap-2">
              <NumField label="CPU Qty" value={cluster.host.cpuQty} onChange={(v) => updateHost({ cpuQty: v })} />
              <NumField label="Cores / CPU" value={cluster.host.coresPerCpu} onChange={(v) => updateHost({ coresPerCpu: v })} />
              <NumField label="Host RAM" suffix="GB" value={cluster.host.ramGb} onChange={(v) => updateHost({ ramGb: v })} />
              {!cluster.storage.externalStorage && (
                <>
                  <NumField label="NVMe Qty" value={cluster.host.nvmeQty} onChange={(v) => updateHost({ nvmeQty: v })} />
                  <NumField label="NVMe Size" suffix="TB" step={0.01} value={cluster.host.nvmeSizeTb} onChange={(v) => updateHost({ nvmeSizeTb: v })} />
                </>
              )}
              <NumField label="CPU Oversub" suffix="×" step={0.1} value={cluster.host.cpuOversub} onChange={(v) => updateHost({ cpuOversub: v })} />
              <NumField label="RAM Oversub" suffix="×" step={0.1} value={cluster.host.ramOversub} onChange={(v) => updateHost({ ramOversub: v })} />
              <NumField label="Reserve" suffix="%" value={cluster.host.reservePct} onChange={(v) => updateHost({ reservePct: v })} />
            </div>
            <label
              className="mt-2 flex items-start gap-2 text-[11px] text-slate-600 cursor-pointer select-none"
              title="When enabled, each physical core provides 2 logical threads (Intel Hyper-Threading / AMD SMT). Increases vCPU sizing capacity only — licensed cores stay based on physical cores to match VCF per-core licensing."
            >
              <input
                type="checkbox"
                checked={!!cluster.host.hyperthreadingEnabled}
                onChange={(e) => updateHost({ hyperthreadingEnabled: e.target.checked })}
                className="mt-0.5 accent-blue-600"
              />
              <span>
                <span className="font-semibold">Hyperthreading (SMT)</span> — model 2 logical threads per
                physical core for vCPU sizing. Licensed cores are unaffected.
              </span>
            </label>
          </Section>

          {!isMgmtCluster && (
            <Section title="Workload VMs">
              <div className="grid grid-cols-2 gap-2">
                <NumField label="VM Count" value={cluster.workload.vmCount} onChange={(v) => updateWorkload({ vmCount: v })} />
                <NumField label="vCPU / VM" value={cluster.workload.vcpuPerVm} onChange={(v) => updateWorkload({ vcpuPerVm: v })} />
                <NumField label="RAM / VM" suffix="GB" value={cluster.workload.ramPerVm} onChange={(v) => updateWorkload({ ramPerVm: v })} />
                <NumField label="Disk / VM" suffix="GB" value={cluster.workload.diskPerVm} onChange={(v) => updateWorkload({ diskPerVm: v })} />
              </div>
            </Section>
          )}

          <Section title={isMgmtCluster ? "Management Appliance Stack" : "Infrastructure Appliances"}>
            {isMgmtCluster && (
              <SizeRecommender stack={cluster.infraStack} onChange={(infraStack) => update({ infraStack })} />
            )}
            <StackPicker
              stack={cluster.infraStack}
              onChange={(infraStack) => update({ infraStack })}
              isMgmtCluster={isMgmtCluster}
              vcfVersion={fleet?.vcfVersion}
            />
            {result.failover && (() => {
              const fo = result.failover;
              const aName = failoverSiteNames?.[0] || "Site A";
              const bName = failoverSiteNames?.[1] || "Site B";
              const colorFor = (v) =>
                v === "green"  ? "text-emerald-700 bg-emerald-50 border-emerald-300"
                : v === "yellow" ? "text-amber-700 bg-amber-50 border-amber-300"
                : "text-rose-700 bg-rose-50 border-rose-300";
              const labelFor = (v) =>
                v === "green"  ? "✓ Fully up"
                : v === "yellow" ? "⚠ Degraded (no reserve)"
                : "✕ Cannot absorb";
              const row = (side, name, hostCount) => (
                <div className={`border rounded px-3 py-2 ${colorFor(side.verdict)}`}>
                  <div className="flex items-baseline justify-between mb-0.5">
                    <span className="text-[10px] uppercase tracking-wider font-mono font-semibold">
                      If {name === aName ? bName : aName} fails →
                    </span>
                    <span className="text-[10px] font-mono font-semibold">{labelFor(side.verdict)}</span>
                  </div>
                  <div className="text-[10px] font-mono opacity-80">
                    {name}: {hostCount} host{hostCount === 1 ? "" : "s"}
                    {typeof side.vcpuUsedPct === "number" &&
                      ` · vCPU ${side.vcpuUsedPct}% · RAM ${side.ramUsedPct}%`}
                  </div>
                  {side.verdict !== "green" && (
                    <div className="text-[10px] font-mono mt-0.5 opacity-70">{side.reason}</div>
                  )}
                </div>
              );
              // One-click targets: find the smallest host count that flips
              // both sites to the requested verdict, and preview the delta
              // from the current cluster total. Clicking applies the number
              // to cluster.hostOverride, which the sizing engine picks up on
              // the next render. null means "already there" — button shows
              // as disabled / "current".
              const hostsNeededGreen  = minHostsForVerdict(cluster, result, domainHostSplitPct, "green");
              const hostsNeededYellow = minHostsForVerdict(cluster, result, domainHostSplitPct, "yellow");
              const currentTotal = result.finalHosts;
              const currentOverride = cluster.hostOverride || 0;
              const applyTarget = (targetHosts) => {
                if (targetHosts == null) return;
                update({ hostOverride: targetHosts });
              };
              const bothGreen = fo.siteA.verdict === "green" && fo.siteB.verdict === "green";
              const bothAtLeastYellow =
                fo.siteA.verdict !== "red" && fo.siteB.verdict !== "red";
              const targetButton = (label, description, need, tone, alreadyMet) => {
                const delta = need != null ? need - currentTotal : null;
                const disabled = need == null || alreadyMet;
                const color =
                  tone === "green"  ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-400"
                  : tone === "yellow" ? "border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400"
                  : "border-slate-300 bg-slate-50 text-slate-700 hover:border-slate-400";
                const disabledColor = "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed";
                return (
                  <button
                    onClick={() => !disabled && applyTarget(need)}
                    disabled={disabled}
                    className={`text-left border rounded p-2 transition-colors ${disabled ? disabledColor : color}`}
                    title={disabled
                      ? (alreadyMet ? "Cluster is already at this target" : "No override can satisfy this target")
                      : `Set Manual override to ${need} hosts`}
                  >
                    <div className="text-[10px] uppercase tracking-wider font-mono font-semibold mb-0.5">{label}</div>
                    <div className="text-[10px] font-mono leading-snug opacity-80">{description}</div>
                    {!disabled && delta != null && (
                      <div className="text-[10px] font-mono font-semibold mt-1">
                        → Set to {need} host{need === 1 ? "" : "s"}
                        {delta > 0
                          ? <span className="opacity-70"> (+{delta} from current {currentTotal})</span>
                          : delta < 0
                            ? <span className="opacity-70"> ({delta} from current {currentTotal})</span>
                            : <span className="opacity-70"> (no change)</span>}
                      </div>
                    )}
                    {alreadyMet && (
                      <div className="text-[10px] font-mono font-semibold mt-1">✓ Already at this target</div>
                    )}
                  </button>
                );
              };
              return (
                <div className="mt-4">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono font-semibold mb-2">
                    ⬢ Stretched-cluster site failover analysis
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {row(fo.siteA, aName, fo.hostsA)}
                    {row(fo.siteB, bName, fo.hostsB)}
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono mt-2 mb-2">
                    ℹ Analysis assumes full cluster demand must run on the survivor. Demand includes any WLD appliances pinned to this cluster. Degraded means the survivor has enough raw capacity only by consuming the configured reserve slack.
                  </p>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono font-semibold mb-1.5">
                    Apply a target
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {targetButton(
                      "✓ Survive failover",
                      "Raise Manual override until both sites absorb full demand within safe reserves.",
                      hostsNeededGreen,
                      "green",
                      bothGreen && currentOverride === hostsNeededGreen,
                    )}
                    {targetButton(
                      "⚠ Degraded but running",
                      "Minimum hosts for both sites to run everything — consuming the configured reserve slack on failover.",
                      hostsNeededYellow,
                      "yellow",
                      bothAtLeastYellow && !bothGreen && currentOverride === hostsNeededYellow,
                    )}
                    {targetButton(
                      "✕ Accept downtime",
                      "No override — current auto sizing only. Site failure means loss of services on the survivor.",
                      0,
                      "gray",
                      currentOverride === 0,
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono mt-1.5">
                    ℹ Targets set the Manual host-count override above. Architectural floors (CPU, RAM, storage, vSAN policy) still win if they're higher.
                  </p>
                </div>
              );
            })()}

            {injectedEntries && injectedEntries.length > 0 && (() => {
              // Pre-aggregate so we can render per-row totals AND a footer row.
              // Using stackTotals would re-read APPLIANCE_DB once per call; doing
              // the math inline keeps it local and avoids paying for a second
              // lookup for fields (label, size) we need anyway.
              let totalVcpu = 0, totalRam = 0, totalDisk = 0;
              const rows = injectedEntries.map((e) => {
                const def = APPLIANCE_DB[e.id];
                const sz = applianceSize(def, e.size, fleet?.vcfVersion);
                const inst = e.instances || 0;
                const vcpu = (sz?.vcpu || 0) * inst;
                const ram  = (sz?.ram  || 0) * inst;
                const disk = applianceEntryDisk(e, def, sz) * inst;
                totalVcpu += vcpu;
                totalRam  += ram;
                totalDisk += disk;
                return { key: e.key, label: def?.label || e.id, size: e.size, inst, vcpu, ram, disk, ownerDomainName: e.ownerDomainName };
              });
              return (
                <div className="mt-4 border-l-2 border-sky-400 pl-3">
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-[10px] uppercase tracking-wider text-sky-700 font-mono font-semibold">
                      ⬢ Hosted for workload domains
                    </span>
                    <span className="text-[9px] text-sky-600 font-mono">
                      read-only — edit from the owning WLD card
                    </span>
                  </div>
                  <table className="w-full text-[11px] font-mono">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                        <th className="text-left font-normal pb-1.5 pl-1">Component</th>
                        <th className="text-left font-normal pb-1.5">Size</th>
                        <th className="text-right font-normal pb-1.5 px-2">Inst</th>
                        <th className="text-right font-normal pb-1.5 px-2">vCPU</th>
                        <th className="text-right font-normal pb-1.5 px-2">RAM (GB)</th>
                        <th className="text-right font-normal pb-1.5 px-2">Disk (GB)</th>
                        <th className="text-left font-normal pb-1.5 pl-3">Owner WLD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.key} className="border-t border-slate-100">
                          <td className="py-1.5 pl-1 text-slate-700">{row.label}</td>
                          <td className="py-1.5 text-slate-500">{row.size}</td>
                          <td className="py-1.5 px-2 text-right text-slate-800 tabular-nums">×{row.inst}</td>
                          <td className="py-1.5 px-2 text-right text-slate-600 tabular-nums">{fmt(row.vcpu)}</td>
                          <td className="py-1.5 px-2 text-right text-slate-600 tabular-nums">{fmt(row.ram)}</td>
                          <td className="py-1.5 px-2 text-right text-slate-600 tabular-nums">{fmt(row.disk)}</td>
                          <td className="py-1.5 pl-3 text-sky-700">{row.ownerDomainName}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-sky-300 bg-sky-50">
                        <td className="py-1.5 pl-1 text-sky-800 font-semibold uppercase tracking-wider text-[10px]">Total injected</td>
                        <td className="py-1.5"></td>
                        <td className="py-1.5 px-2 text-right text-sky-800 tabular-nums font-semibold">{rows.length} {rows.length === 1 ? "row" : "rows"}</td>
                        <td className="py-1.5 px-2 text-right text-sky-800 tabular-nums font-semibold">{fmt(totalVcpu)}</td>
                        <td className="py-1.5 px-2 text-right text-sky-800 tabular-nums font-semibold">{fmt(totalRam)}</td>
                        <td className="py-1.5 px-2 text-right text-sky-800 tabular-nums font-semibold">{fmt(totalDisk)}</td>
                        <td className="py-1.5 pl-3"></td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="text-[10px] text-slate-400 font-mono mt-1">
                    ℹ These appliances are charged to this cluster's demand (already counted in the host total above). To edit or move them, open the owning workload domain's card.
                  </p>
                </div>
              );
            })()}
          </Section>

          {!cluster.storage.externalStorage ? (
            <Section title="vSAN ESA Storage">
              <div className="grid grid-cols-2 gap-2">
                <SelectField
                  label="Protection Policy"
                  value={cluster.storage.policy}
                  onChange={(v) => updateStorage({ policy: v })}
                  options={Object.entries(POLICIES).map(([k, v]) => ({
                    value: k,
                    label: `${v.label} · PF ${v.pf}× · min ${v.minHosts}`,
                  }))}
                />
                <NumField label="Dedup Ratio" step={0.1} value={cluster.storage.dedup} onChange={(v) => updateStorage({ dedup: v })} />
                <NumField label="Compression" step={0.1} value={cluster.storage.compression} onChange={(v) => updateStorage({ compression: v })} />
                <NumField label="VM Swap" suffix="%" value={cluster.storage.swapPct} onChange={(v) => updateStorage({ swapPct: v })} />
                <NumField label="vSAN Free" suffix="%" value={cluster.storage.freePct} onChange={(v) => updateStorage({ freePct: v })} />
                <NumField label="Growth" suffix="%" value={cluster.storage.growthPct} onChange={(v) => updateStorage({ growthPct: v })} />
              </div>
            </Section>
          ) : (
            <Section title="External Array">
              <NumField
                label="Estimated Array Capacity"
                suffix="TiB"
                value={cluster.storage.externalArrayTib}
                onChange={(v) => updateStorage({ externalArrayTib: v })}
              />
            </Section>
          )}

          {!cluster.storage.externalStorage && (
            <Section title="NVMe Memory Tiering" right={
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500 cursor-pointer">
              <input
                type="checkbox"
                checked={cluster.tiering.enabled}
                onChange={(e) => updateTiering({ enabled: e.target.checked })}
                className="accent-blue-600"
              />
              Enabled
            </label>
          }>
            {cluster.tiering.enabled ? (
              <div className="grid grid-cols-3 gap-2">
                <NumField label="Mem.TierNvmePct" suffix="%" step={5} value={cluster.tiering.nvmePct} onChange={(v) => updateTiering({ nvmePct: v })} />
                <NumField label="Eligible Workload" suffix="%" value={cluster.tiering.eligibilityPct} onChange={(v) => updateTiering({ eligibilityPct: v })} />
                <NumField label="Tier Drive" suffix="TB" step={0.01} value={cluster.tiering.tierDriveSizeTb} onChange={(v) => updateTiering({ tierDriveSizeTb: v })} />
              </div>
            ) : (
              <p className="text-[10px] text-slate-400 font-mono">
                Tiering disabled. Effective RAM = physical DRAM only.
              </p>
            )}
          </Section>
          )}

          {/* ─── Networking — VCF-NET / VCF-IP / VCF-HW-NET ─── */}
          <Section title="Networking" right={
            <select
              value={cluster.networks?.nicProfileId || "4-nic"}
              onChange={(e) => {
                const profileId = e.target.value;
                const profile = NIC_PROFILES[profileId];
                if (profile) {
                  update({
                    networks: {
                      ...cluster.networks,
                      nicProfileId: profileId,
                      vds: profile.vds.map(function(v) { return { name: v.name, uplinks: v.uplinks.slice(), mtu: v.mtu }; }),
                    },
                  });
                }
              }}
              className="text-[10px] font-mono bg-white border border-slate-200 rounded px-2 py-0.5 text-slate-600"
              title="VCF-HW-NET-001..004: Physical NIC profile"
            >
              {Object.keys(NIC_PROFILES).map((k) => (
                <option key={k} value={k}>{k} ({NIC_PROFILES[k].nicCount} NICs)</option>
              ))}
            </select>
          }>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
              {[
                { key: "mgmt", label: "Management" },
                { key: "vmotion", label: "vMotion" },
                { key: "vsan", label: "vSAN" },
                { key: "hostTep", label: "Host TEP" },
                { key: "edgeTep", label: "Edge TEP" },
              ].map(({ key, label }) => {
                const net = cluster.networks?.[key] || {};
                const updateNet = (patch) => update({
                  networks: { ...cluster.networks, [key]: { ...net, ...patch } },
                });
                return (
                  <div key={key} className="border border-slate-100 rounded p-2 bg-slate-50">
                    <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500 font-mono font-semibold mb-1.5">{label}</div>
                    <div className="space-y-1">
                      <label className="flex items-center gap-1">
                        <span className="text-[9px] text-slate-400 font-mono w-12">VLAN</span>
                        <input type="number" value={net.vlan ?? ""} onChange={(e) => updateNet({ vlan: e.target.value ? parseInt(e.target.value, 10) : null })}
                          className="text-[11px] font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5 w-16 text-slate-700" />
                      </label>
                      <label className="flex items-center gap-1">
                        <span className="text-[9px] text-slate-400 font-mono w-12">Subnet</span>
                        <input value={net.subnet ?? ""} onChange={(e) => updateNet({ subnet: e.target.value || null })}
                          placeholder="10.0.0.0/24"
                          className="text-[11px] font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5 flex-1 text-slate-700" />
                      </label>
                      <label className="flex items-center gap-1">
                        <span className="text-[9px] text-slate-400 font-mono w-12">Gateway</span>
                        <input value={net.gateway ?? ""} onChange={(e) => updateNet({ gateway: e.target.value || null })}
                          placeholder="10.0.0.1"
                          className="text-[11px] font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5 flex-1 text-slate-700" />
                      </label>
                      <div className="flex gap-1">
                        <label className="flex items-center gap-1 flex-1">
                          <span className="text-[9px] text-slate-400 font-mono">Start</span>
                          <input value={net.pool?.start ?? ""} onChange={(e) => updateNet({ pool: { ...net.pool, start: e.target.value || null } })}
                            placeholder=".10"
                            className="text-[11px] font-mono bg-white border border-slate-200 rounded px-1 py-0.5 w-full text-slate-700" />
                        </label>
                        <label className="flex items-center gap-1 flex-1">
                          <span className="text-[9px] text-slate-400 font-mono">End</span>
                          <input value={net.pool?.end ?? ""} onChange={(e) => updateNet({ pool: { ...net.pool, end: e.target.value || null } })}
                            placeholder=".50"
                            className="text-[11px] font-mono bg-white border border-slate-200 rounded px-1 py-0.5 w-full text-slate-700" />
                        </label>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Plan 7 — vDS topology with editable names + Re-apply button */}
            <div className="border border-slate-200 rounded p-2 mb-2 bg-slate-50">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono">
                  vDS topology · {cluster.networks?.nicProfileId || "4-nic"}
                </div>
                {fleet?.namingConfig?.vdsTemplate && (
                  <button
                    onClick={() => {
                      const next = applyVdsTemplate(fleet, instance, domain, cluster);
                      if (next && next.networks) update({ networks: next.networks });
                    }}
                    className="text-[10px] font-mono uppercase tracking-wider text-slate-500 hover:text-blue-600 border border-dashed border-slate-300 hover:border-blue-400 rounded px-2 py-0.5"
                    title="Regenerate stored vDS names from the fleet's vDS template. Hand-edited names will be overwritten."
                  >
                    ↻ Re-apply naming template
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {(cluster.networks?.vds || []).map((v, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                    <input
                      value={v.name}
                      onChange={(e) => {
                        const nextVds = (cluster.networks?.vds || []).map((slot, idx) =>
                          idx === i ? { ...slot, name: e.target.value } : slot
                        );
                        update({ networks: { ...cluster.networks, vds: nextVds } });
                      }}
                      className="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-700 w-64"
                      title="vDS name. Edit directly or set a fleet-level vDS template and click 'Re-apply'."
                    />
                    <span className="text-slate-400">[{v.uplinks.join(",")}]</span>
                    <span className="text-slate-400">MTU {v.mtu}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          {/* T0 Gateway editor — VCF-APP-006 / VCF-INV-060..065 */}
          <Section title="T0 Gateways (NSX Edge topology)" right={
            <button
              onClick={addT0}
              className="text-[10px] font-mono uppercase tracking-wider text-slate-400 hover:text-sky-700 border border-dashed border-slate-200 hover:border-sky-400 rounded px-2 py-0.5"
              title="Add a new Tier-0 gateway. Bind nsxEdge stack entries to it below."
            >
              + Add T0
            </button>
          }>
            {/* Edge cluster deployment model — VCF-APP-006 §"Deployment Models" */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono">
                Edge Deployment Model
              </label>
              <select
                value={cluster.edgeDeploymentModel || ""}
                onChange={(e) => update({ edgeDeploymentModel: e.target.value || null })}
                className="text-[11px] font-mono bg-white border border-slate-200 rounded px-2 py-1 text-slate-700"
                title="VCF-APP-006: NSX Edge cluster topology. Informational — drives DC layout expectations, not sizing."
              >
                <option value="">— unspecified —</option>
                {Object.entries(EDGE_DEPLOYMENT_MODELS).map(([key, def]) => (
                  <option key={key} value={key}>{def.label} ({def.ruleId})</option>
                ))}
              </select>
              {cluster.edgeDeploymentModel && (
                <span className="text-[10px] text-slate-500 italic font-mono max-w-lg">
                  {EDGE_DEPLOYMENT_MODELS[cluster.edgeDeploymentModel]?.description}
                </span>
              )}
            </div>
            {t0s.length === 0 ? (
              <p className="text-[10px] text-slate-400 font-mono">
                No T0 gateways defined on this cluster. Add one and bind nsxEdge stack entries.
              </p>
            ) : (
              <div className="space-y-2">
                {t0s.map((t0, idx) => {
                  const mode = T0_HA_MODES[t0.haMode];
                  return (
                    <div key={t0.id} className="border border-slate-200 rounded p-2 bg-slate-50">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <input
                          value={t0.name}
                          onChange={(e) => updateT0(idx, { name: e.target.value })}
                          className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1 text-slate-800 w-32"
                        />
                        <select
                          value={t0.haMode}
                          onChange={(e) => updateT0(idx, { haMode: e.target.value })}
                          className="text-[11px] font-mono bg-white border border-slate-200 rounded px-2 py-1 text-slate-700"
                          title={`VCF-APP-006-T0-* — ${mode?.description || ""}`}
                        >
                          {Object.entries(T0_HA_MODES).map(([key, def]) => (
                            <option key={key} value={key}>{def.label} (max {def.maxEdgeNodes})</option>
                          ))}
                        </select>
                        {t0.haMode === "active-active" && (
                          <label className="flex items-center gap-1 text-[10px] font-mono text-slate-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!t0.stateful}
                              onChange={(e) => updateT0(idx, { stateful: e.target.checked })}
                              className="accent-blue-600"
                            />
                            Stateful (Day-2)
                          </label>
                        )}
                        <label className="flex items-center gap-1 text-[10px] font-mono text-slate-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!t0.bgpEnabled}
                            onChange={(e) => updateT0(idx, { bgpEnabled: e.target.checked })}
                            className="accent-blue-600"
                          />
                          BGP
                        </label>
                        <button
                          onClick={() => removeT0(idx)}
                          className="text-slate-400 hover:text-rose-600 text-sm px-1"
                          aria-label="Remove T0"
                        >×</button>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">Edge Nodes</span>
                        {edgeEntries.length === 0 ? (
                          <span className="text-[10px] text-slate-400 font-mono italic">No nsxEdge entries on this cluster — add one in the Appliances table above.</span>
                        ) : edgeEntries.map((ee) => {
                          const selected = (t0.edgeNodeKeys || []).includes(ee.key);
                          return (
                            <button
                              key={ee.key}
                              onClick={() => toggleT0Edge(idx, ee.key)}
                              className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                                selected
                                  ? "bg-sky-600 text-white border-sky-600"
                                  : "bg-white text-slate-600 border-slate-200 hover:border-sky-400"
                              }`}
                            >
                              {ee.size} ×{ee.instances}
                            </button>
                          );
                        })}
                        <span className="text-[10px] text-slate-500 font-mono ml-2">
                          bound: {(t0.edgeNodeKeys || []).length} / max {mode?.maxEdgeNodes ?? "?"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">Required For</span>
                        {["vks", "vcfAutomationAllApps"].map((feat) => {
                          const on = (t0.featureRequirements || []).includes(feat);
                          return (
                            <button
                              key={feat}
                              onClick={() => updateT0(idx, {
                                featureRequirements: on
                                  ? (t0.featureRequirements || []).filter((f) => f !== feat)
                                  : [...(t0.featureRequirements || []), feat],
                              })}
                              className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                                on
                                  ? "bg-amber-500 text-white border-amber-500"
                                  : "bg-white text-slate-600 border-slate-200 hover:border-amber-400"
                              }`}
                              title={feat === "vks" ? "vSphere Supervisor (VKS) requires Active/Standby T0" : "VCF Automation All Apps requires Active/Standby T0"}
                            >
                              {feat === "vks" ? "VKS" : "Auto All-Apps"}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {t0Issues.length > 0 && (
                  <div className="border border-rose-300 bg-rose-50 rounded p-2 space-y-1">
                    {t0Issues.map((issue, i) => (
                      <div key={i} className={`text-[10px] font-mono ${issue.severity === "critical" ? "text-rose-700" : "text-amber-700"}`}>
                        <span className="font-semibold">{issue.ruleId}</span> · {issue.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Section>
        </div>

        {/* RIGHT: results */}
        <div>
          <Section title="Result">
            <div className="bg-white border border-slate-200 rounded p-3 mb-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400 mb-1">Hosts Required</div>
              <div className="flex items-baseline gap-4">
                <span className="text-4xl font-serif text-slate-900 tabular-nums">{result.finalHosts}</span>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Limiter</span>
                  <span className={`text-sm font-mono uppercase ${limiterColor}`}>{result.limiter}</span>
                </div>
              </div>
            </div>

            {result.vsanMinWarning && (
              <div className="bg-amber-50 border border-amber-300 rounded p-3 mb-3">
                <div className="flex items-start gap-2">
                  <span className="text-amber-700 font-mono text-sm leading-none mt-0.5">⚠</span>
                  <div className="flex-1">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-amber-800 font-mono font-semibold mb-1">
                      Recommended: 4-node minimum for vSAN
                    </div>
                    <p className="text-[11px] text-amber-800 font-mono leading-snug">
                      A 3-node vSAN cluster meets the architectural minimum but cannot auto-heal after a
                      host failure — rebuild requires a replacement host before redundancy is restored. A
                      4th node provides a spare fault domain, enabling automatic re-protection after
                      failures or during maintenance. Consider setting a Host Override of 4 below, or
                      choosing a storage policy with a higher minimum.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Manual host-count override — adds a "Manual" floor that the
                sizing engine compares against the computed architectural
                minimum. Lets the user raise finalHosts (e.g. to survive
                stretched-cluster site failover) without touching host
                specs. Can only increase hosts; architectural floors still
                win if they're higher. */}
            <div className="bg-emerald-50 border border-emerald-200 rounded p-3 mb-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-800 font-mono font-semibold">
                    Manual host-count override
                  </div>
                  <p className="text-[10px] text-emerald-700 font-mono mt-0.5 leading-snug">
                    Force at least N hosts regardless of demand math. Use to raise the survivor count on a stretched cluster.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={cluster.hostOverride || 0}
                    onChange={(e) => update({ hostOverride: Math.max(0, parseInt(e.target.value) || 0) })}
                    className="w-16 bg-white border border-emerald-300 rounded px-2 py-1 text-slate-800 font-mono text-sm text-right focus:outline-none focus:border-emerald-500"
                    title="0 = auto (use architectural minimum)"
                  />
                  {(cluster.hostOverride || 0) > 0 && (
                    <button
                      onClick={() => update({ hostOverride: 0 })}
                      className="text-[10px] uppercase tracking-wider text-emerald-700 hover:text-rose-600 border border-emerald-300 hover:border-rose-400 rounded px-2 py-1 font-mono"
                      title="Reset to automatic"
                    >
                      Auto
                    </button>
                  )}
                </div>
              </div>
              {(cluster.hostOverride || 0) > 0 && result.limiter !== "Manual" && (
                <p className="text-[10px] text-amber-700 font-mono mt-2">
                  ⚠ Override ({cluster.hostOverride}) is below an architectural floor — the {result.limiter.toLowerCase()} minimum ({result.finalHosts}) wins.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <FloorRow label="CPU floor"     value={result.floors.cpuHosts}    active={result.limiter === "Compute"} />
              <FloorRow label="RAM floor"     value={result.floors.ramHosts}    active={result.limiter === "Memory"} />
              {!cluster.storage.externalStorage && (
                <FloorRow label="Storage floor" value={result.floors.storageHosts} active={result.limiter === "Storage"} />
              )}
              <FloorRow label="Policy min"    value={result.floors.policyMin}   active={result.limiter === "Policy"} />
              {(cluster.hostOverride || 0) > 0 && (
                <FloorRow label="Manual floor" value={result.floors.manualOverride} active={result.limiter === "Manual"} />
              )}
            </div>
          </Section>

          {/* ─── Per-Host IP Assignments ─── */}
          {cluster.networks?.mgmt?.pool?.start && (
            <Section title="Per-Host IP Assignments">
              {(() => {
                const ipPlan = allocateClusterIps(cluster, result.finalHosts, { fleet, instance, domain });
                // Plan 7 — per-host hostname override editor. Writes to
                // cluster.hostOverrides[i].hostname; null = template-resolved.
                const updateHostnameOverride = (hostIndex, hostname) => {
                  const overrides = cluster.hostOverrides || [];
                  const existing = overrides.find((o) => o.hostIndex === hostIndex);
                  let next;
                  if (existing) {
                    next = overrides.map((o) =>
                      o.hostIndex === hostIndex
                        ? { ...o, hostname: hostname || null }
                        : o
                    );
                    // If the override is now entirely null/zero, drop it.
                    const stillUseful = next.find((o) =>
                      o.hostIndex === hostIndex && (o.mgmtIp || o.vmotionIp || o.vsanIp || o.hostTepIps || o.bmcIp || o.hostname)
                    );
                    if (!stillUseful) next = next.filter((o) => o.hostIndex !== hostIndex);
                  } else if (hostname) {
                    next = [...overrides, { ...createHostIpOverride(hostIndex), hostname }];
                  } else {
                    next = overrides;
                  }
                  update({ hostOverrides: next });
                };
                return (
                  <div>
                    {ipPlan.warnings.length > 0 && (
                      <div className="mb-2 space-y-1">
                        {ipPlan.warnings.map((w, wi) => (
                          <div key={wi} className={`text-[10px] font-mono px-2 py-1 rounded ${
                            w.severity === "error" ? "bg-rose-50 text-rose-700 border border-rose-200" :
                            w.severity === "warn" ? "bg-amber-50 text-amber-700 border border-amber-200" :
                            "bg-sky-50 text-sky-700 border border-sky-200"
                          }`}>
                            [{w.ruleId}] {w.message}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="overflow-x-auto">
                      <table className="text-[10px] font-mono w-full border-collapse">
                        <thead>
                          <tr className="text-slate-400 uppercase tracking-wider">
                            <th className="text-left px-1 py-1 border-b border-slate-200">#</th>
                            <th className="text-left px-1 py-1 border-b border-slate-200">Hostname</th>
                            <th className="text-left px-1 py-1 border-b border-slate-200">vmk0 (Mgmt)</th>
                            <th className="text-left px-1 py-1 border-b border-slate-200">vmk1 (vMotion)</th>
                            <th className="text-left px-1 py-1 border-b border-slate-200">vmk2 (vSAN)</th>
                            <th className="text-left px-1 py-1 border-b border-slate-200">vmk10/11 (TEP)</th>
                            <th className="text-left px-1 py-1 border-b border-slate-200">Source</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ipPlan.hosts.map((h) => {
                            const ov = (cluster.hostOverrides || []).find((o) => o.hostIndex === h.index);
                            const isHostnameOverride = !!(ov && ov.hostname);
                            return (
                              <tr key={h.index} className={h.source === "override" ? "bg-amber-50" : ""}>
                                <td className="px-1 py-0.5 border-b border-slate-100 text-slate-400">{h.index}</td>
                                <td className="px-1 py-0.5 border-b border-slate-100">
                                  <input
                                    value={(ov && ov.hostname) || ""}
                                    placeholder={h.hostname || "(no template)"}
                                    onChange={(e) => updateHostnameOverride(h.index, e.target.value.trim())}
                                    className={`text-[10px] font-mono bg-white border rounded px-1 py-0.5 w-full ${
                                      isHostnameOverride ? "border-amber-400 text-amber-800" : "border-slate-200 text-slate-700"
                                    }`}
                                    title="Per-host hostname override. Empty = use fleet/cluster template (shown in placeholder when set). Beats template + cluster overrides."
                                  />
                                </td>
                                <td className="px-1 py-0.5 border-b border-slate-100 text-slate-700">{h.mgmtIp || "—"}</td>
                                <td className="px-1 py-0.5 border-b border-slate-100 text-slate-700">{h.vmotionIp || "—"}</td>
                                <td className="px-1 py-0.5 border-b border-slate-100 text-slate-700">{h.vsanIp || "—"}</td>
                                <td className="px-1 py-0.5 border-b border-slate-100 text-slate-700">{h.hostTepIps ? h.hostTepIps.join(", ") : "DHCP"}</td>
                                <td className="px-1 py-0.5 border-b border-slate-100">{h.source === "override" ?
                                  <span className="text-amber-600">override</span> :
                                  <span className="text-slate-400">pool</span>
                                }</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {ipPlan.edgeNodes.length > 0 && (
                      <div className="mt-2">
                        <div className="text-[9px] uppercase tracking-wider text-slate-400 mb-1">Edge Node TEP Assignments</div>
                        <table className="text-[10px] font-mono w-full border-collapse">
                          <thead>
                            <tr className="text-slate-400 uppercase tracking-wider">
                              <th className="text-left px-1 py-1 border-b border-slate-200">Edge</th>
                              <th className="text-left px-1 py-1 border-b border-slate-200">TEP IPs</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ipPlan.edgeNodes.map((en, ei) => (
                              <tr key={ei}>
                                <td className="px-1 py-0.5 border-b border-slate-100 text-slate-500">{en.edgeNodeKey}</td>
                                <td className="px-1 py-0.5 border-b border-slate-100 text-slate-700">{en.edgeTepIps.filter(Boolean).join(", ") || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}
            </Section>
          )}

          <Section title="Per-Host Capacity">
            <div className="text-xs font-mono text-slate-600 space-y-1">
              <Row
                k="Cores"
                v={
                  cluster.host.hyperthreadingEnabled
                    ? `${fmt(result.host.cores)} / ${fmt(result.host.threads)} threads`
                    : fmt(result.host.cores)
                }
              />
              <Row k="Usable vCPU"  v={fmt(result.host.usableVcpu, 1)} />
              <Row k="Usable RAM"   v={`${fmt(result.host.usableRam, 0)} GB`} />
              {cluster.tiering.enabled && (
                <>
                  <Row k="Tier partition"  v={`${fmt(result.tier.tierPartitionGb)} GB`} />
                  <Row k="Effective RAM"   v={`${fmt(result.tier.effectiveRamPerHost, 0)} GB`} />
                </>
              )}
              {!cluster.storage.externalStorage && (
                <Row k="Raw NVMe"     v={`${fmt((result.host.rawGb / 1000) * TB_TO_TIB, 1)} TiB`} />
              )}
            </div>
          </Section>

          <Section title="Demand">
            <div className="text-xs font-mono text-slate-600 space-y-1">
              <Row k="vCPU"  v={fmt(result.demand.vcpu)} />
              <Row k="RAM"   v={`${fmt(result.demand.ram)} GB`} />
              <Row k="Disk"  v={`${fmt(result.demand.disk)} GB`} />
              {cluster.tiering.enabled && (
                <Row k="Tiered RAM demand" v={`${fmt(result.tier.tieredDemandRamGb, 0)} GB`} />
              )}
            </div>
          </Section>

          {result.pipeline && (
            <Section title="Storage Pipeline">
              <div className="text-xs font-mono text-slate-600 space-y-1">
                <Row k="DRR"             v={`${fmt(result.pipeline.drr, 2)}×`} />
                <Row k="VM Capacity"     v={`${fmt(result.pipeline.vmCapGb)} GB`} />
                <Row k="+ Swap"          v={`${fmt(result.pipeline.swapGb)} GB`} />
                <Row k="× PF"            v={`${fmt(result.pipeline.pf, 2)}× → ${fmt(result.pipeline.protectedGb)} GB`} />
                <Row k="× Free"          v={`${fmt(result.pipeline.withFreeGb)} GB`} />
                <Row k="× Growth"        v={`${fmt(result.pipeline.totalReqGb)} GB`} />
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMAIN CARD — thin container that holds clusters
// ─────────────────────────────────────────────────────────────────────────────
function DomainCard({ domain, isStretched, instanceSiteIds, allSites, eligibleClusters, defaultInstancesById, injectedByClusterId, onChange, onRemove, canRemove, result, fleet, instance }) {
  const update = (patch) => onChange({ ...domain, ...patch });

  const updateCluster = (idx, next) => {
    onChange({ ...domain, clusters: domain.clusters.map((c, i) => (i === idx ? next : c)) });
  };
  const addCluster = () => {
    const next = domain.type === "mgmt"
      ? newMgmtCluster(`mgmt-cluster-${domain.clusters.length + 1}`)
      : newWorkloadCluster(`wld-cluster-${domain.clusters.length + 1}`);
    next.isDefault = false;
    onChange({ ...domain, clusters: [...domain.clusters, next] });
  };
  const removeCluster = (idx) => {
    if (domain.clusters.length <= 1) return;
    onChange({ ...domain, clusters: domain.clusters.filter((_, i) => i !== idx) });
  };

  const isMgmt = domain.type === "mgmt";
  const isStretchedDomain = isStretched && domain.placement === "stretched";
  const borderColor = isMgmt ? "border-violet-300" : "border-rose-300";
  const tagColor = isMgmt ? "text-violet-700" : "text-rose-700";
  const tagLabel = isMgmt ? "MGMT DOMAIN" : "WORKLOAD DOMAIN";
  const isImported = !isMgmt && domain.imported === true;

  // Which site this local domain is pinned to. Falls back to siteIds[0] if
  // the stored value is missing or no longer valid (site was removed).
  const siteIds = instanceSiteIds || [];
  const effectiveLocalSiteId =
    domain.localSiteId && siteIds.includes(domain.localSiteId)
      ? domain.localSiteId
      : siteIds[0] || null;
  const effectiveLocalSite = (allSites || []).find((s) => s.id === effectiveLocalSiteId);

  // Toggle stretched ↔ local from the header checkbox. When going back to
  // local we must set a concrete localSiteId so the domain doesn't become
  // unprojectable; we keep any existing pin that's still valid.
  const handleStretchedToggle = (checked) => {
    if (checked) {
      // Default the stretched pair to the first two sites on the instance
      // (today's 2-site instances have exactly one valid choice; multi-site
      // instances pick the pair explicitly in Phase 4).
      const prevPair = Array.isArray(domain.stretchSiteIds) ? domain.stretchSiteIds : [];
      const pairStillValid =
        prevPair.length === 2 && prevPair.every((sid) => siteIds.includes(sid));
      const nextPair = pairStillValid
        ? prevPair
        : siteIds.length >= 2 ? [siteIds[0], siteIds[1]] : null;
      update({ placement: "stretched", localSiteId: null, stretchSiteIds: nextPair });
    } else {
      update({ placement: "local", localSiteId: effectiveLocalSiteId, stretchSiteIds: null });
    }
  };

  return (
    <div className={`border-l-2 ${borderColor} pl-4 mb-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-[9px] uppercase tracking-[0.18em] ${tagColor} font-mono font-semibold`}>
            ▸ {tagLabel}
          </span>
          <input
            value={domain.name}
            onChange={(e) => update({ name: e.target.value })}
            className="bg-transparent text-lg text-slate-800 font-serif border-none focus:outline-none focus:bg-slate-50 rounded px-1"
          />
          {isStretchedDomain && (
            <span className="text-[9px] uppercase tracking-wider text-blue-600 font-mono font-semibold bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
              ↔ Stretched
            </span>
          )}
          {!isStretchedDomain && effectiveLocalSite && (
            <span className="text-[9px] uppercase tracking-wider text-slate-500 font-mono bg-slate-50 border border-slate-200 rounded px-2 py-0.5">
              @ {effectiveLocalSite.name}
            </span>
          )}
          {!isStretchedDomain && !effectiveLocalSite && (
            <span className="text-[9px] uppercase tracking-wider text-slate-400 font-mono bg-slate-50 border border-slate-200 rounded px-2 py-0.5">
              Local · no site
            </span>
          )}
          {isImported && (
            <span
              title="This workload domain was imported (VCF-PATH-004 brownfield). Pre-existing vCenter / NSX Manager appliances may live on workload-domain hosts."
              className="text-[9px] uppercase tracking-wider text-amber-700 font-mono font-semibold bg-amber-50 border border-amber-300 rounded px-2 py-0.5"
            >
              ⌂ Brownfield
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Local domain → per-site pinner. Shown whenever the instance
              touches 2+ sites so the user can pin to any of them. */}
          {isStretched && !isStretchedDomain && siteIds.length >= 2 && (
            <div className="flex items-center gap-0.5 bg-slate-50 border border-slate-200 rounded p-0.5">
              {siteIds.map((sid) => {
                const site = (allSites || []).find((s) => s.id === sid);
                const active = effectiveLocalSiteId === sid;
                return (
                  <button
                    key={sid}
                    onClick={() => update({ localSiteId: sid })}
                    className={`text-[10px] font-mono px-2 py-0.5 rounded transition-colors ${
                      active
                        ? "bg-white text-slate-800 border border-slate-300 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                    title={`Pin this domain to ${site?.name || "site"}`}
                  >
                    @ {site?.name || "?"}
                  </button>
                );
              })}
            </div>
          )}
          {isStretched && (
            <label className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono cursor-pointer select-none">
              <input
                type="checkbox"
                checked={domain.placement === "stretched"}
                onChange={(e) => handleStretchedToggle(e.target.checked)}
                className="accent-blue-600"
              />
              Stretch across sites
            </label>
          )}
          {!isMgmt && (
            <label
              className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono cursor-pointer select-none"
              title="Mark this workload domain as imported (VCF-PATH-004 brownfield). Imported domains keep pre-existing appliance placement; greenfield domains follow Broadcom's mgmt-domain placement rule (VCF-INV-003)."
            >
              <input
                type="checkbox"
                checked={isImported}
                onChange={(e) => update({ imported: e.target.checked })}
                className="accent-amber-600"
              />
              Imported (brownfield)
            </label>
          )}
          <span className="text-[10px] text-slate-400 font-mono">
            {result.totalHosts} hosts · {fmt(result.totalCores)} cores
          </span>
          {canRemove && (
            <button
              onClick={onRemove}
              className="text-slate-400 hover:text-rose-600 text-[10px] uppercase tracking-wider px-2 py-0.5 border border-slate-200 rounded"
            >
              Remove Domain
            </button>
          )}
        </div>
      </div>

      {isStretchedDomain && siteIds.length > 2 && (
        <div className="bg-blue-50 border border-blue-200 rounded px-4 py-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-blue-800 font-mono font-semibold uppercase tracking-wider">
              ↔ Stretch Pair — Which Two Sites
            </span>
            <span className="text-[10px] text-blue-600 font-mono italic">
              Instance touches {siteIds.length} sites · pick the 2 this domain stretches across
            </span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <div className="text-[10px] text-blue-700 font-mono mb-1 uppercase tracking-wider">Primary</div>
              <select
                value={(domain.stretchSiteIds || [])[0] || ""}
                onChange={(e) => {
                  const a = e.target.value;
                  const b = (domain.stretchSiteIds || [])[1];
                  const next = [a, b === a ? siteIds.find((s) => s !== a) : b].filter(Boolean);
                  update({ stretchSiteIds: next.length === 2 ? next : [a, siteIds.find((s) => s !== a)] });
                }}
                className="text-xs font-mono bg-white border border-blue-200 rounded px-2 py-1"
              >
                {siteIds.map((sid) => {
                  const s = (allSites || []).find((x) => x.id === sid);
                  return <option key={sid} value={sid}>{s?.name || sid}</option>;
                })}
              </select>
            </div>
            <span className="text-blue-600 font-mono mt-4">↔</span>
            <div>
              <div className="text-[10px] text-blue-700 font-mono mb-1 uppercase tracking-wider">Secondary</div>
              <select
                value={(domain.stretchSiteIds || [])[1] || ""}
                onChange={(e) => {
                  const b = e.target.value;
                  const a = (domain.stretchSiteIds || [])[0];
                  const next = [a === b ? siteIds.find((s) => s !== b) : a, b].filter(Boolean);
                  update({ stretchSiteIds: next.length === 2 ? next : [siteIds.find((s) => s !== b), b] });
                }}
                className="text-xs font-mono bg-white border border-blue-200 rounded px-2 py-1"
              >
                {siteIds.map((sid) => {
                  const s = (allSites || []).find((x) => x.id === sid);
                  return <option key={sid} value={sid}>{s?.name || sid}</option>;
                })}
              </select>
            </div>
          </div>
        </div>
      )}

      {isStretchedDomain && (
        <div className="bg-blue-50 border border-blue-200 rounded px-4 py-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-blue-800 font-mono font-semibold uppercase tracking-wider">
              ↔ Stretched Cluster — Host Distribution
            </span>
            <span className="text-[10px] text-blue-600 font-mono">
              {result.totalHosts} total hosts across both sites
            </span>
          </div>
          <div className="flex items-center gap-4 mb-2">
            <span className="text-[11px] text-blue-700 font-mono w-32">Primary Site</span>
            <input
              type="range"
              min={10}
              max={90}
              step={5}
              value={domain.hostSplitPct ?? 50}
              onChange={(e) => update({ hostSplitPct: parseInt(e.target.value) })}
              className="flex-1 accent-blue-600"
            />
            <span className="text-[11px] text-blue-700 font-mono w-32 text-right">Secondary Site</span>
          </div>
          <div className="flex justify-between text-[11px] font-mono text-blue-800 font-semibold">
            <span>{Math.ceil(result.totalHosts * ((domain.hostSplitPct ?? 50) / 100))} hosts ({domain.hostSplitPct ?? 50}%)</span>
            <span>{result.totalHosts - Math.ceil(result.totalHosts * ((domain.hostSplitPct ?? 50) / 100))} hosts ({100 - (domain.hostSplitPct ?? 50)}%)</span>
          </div>
          <p className="text-[10px] text-blue-600 font-mono mt-2">
            Adjust the ratio to reflect your actual host placement. vSAN stretched clusters require a witness at a third fault domain; array-based replication does not.
          </p>
        </div>
      )}

      {!isMgmt && (() => {
        const options = eligibleClusters || [];
        const mgmtOptions = options.filter((o) => o.scope === "mgmt");
        const wldOptions = options.filter((o) => o.scope === "wld");
        // Plan 2 — gate the domain default selector by Broadcom placement
        // rules. Greenfield workload domains can only pin to mgmt-domain
        // clusters; imported (brownfield) domains may pick from either.
        // The wldOptions group still renders when imported because that's
        // where pre-existing appliance VMs may live.
        const visibleWldOptions = isImported ? wldOptions : [];
        const selectedId =
          options.some((o) => o.id === domain.componentsClusterId)
            ? domain.componentsClusterId
            : (mgmtOptions[0]?.id || visibleWldOptions[0]?.id || "");
        // Plan 5 — VCF-INV-003 placement-constraint issues for THIS domain.
        // We synthesize a single-instance / single-domain fleet so the
        // validator only flags entries owned here. Sufficient because the
        // validator is per-domain by construction.
        const placementIssues = validatePlacementConstraints({
          instances: [{
            id: "__scoped__",
            domains: [
              { type: "mgmt", id: "__scoped_mgmt__", clusters: mgmtOptions.map((o) => ({ id: o.id })) },
              domain,
            ],
          }],
        });
        return (
          <div className="bg-slate-50 border border-slate-200 rounded px-4 py-3 mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-[0.16em] text-slate-700 font-mono font-semibold">
                ⬢ WLD Components
              </span>
              <label className="flex items-center gap-2 text-[10px] font-mono text-slate-600">
                <span className="uppercase tracking-wider text-slate-400">Host appliances on</span>
                <select
                  value={selectedId}
                  onChange={(e) => update({ componentsClusterId: e.target.value })}
                  className="bg-white border border-slate-200 rounded px-2 py-1 text-slate-800 font-mono text-[11px] focus:outline-none focus:border-blue-500"
                  disabled={options.length === 0}
                >
                  {options.length === 0 && <option value="">(no clusters)</option>}
                  {mgmtOptions.length > 0 && (
                    <optgroup label="Mgmt Domain">
                      {mgmtOptions.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </optgroup>
                  )}
                  {visibleWldOptions.length > 0 && (
                    <optgroup label="This Workload Domain (brownfield)">
                      {visibleWldOptions.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
            </div>
            <p className="text-[10px] text-slate-500 font-mono leading-relaxed mb-3">
              Per Broadcom VCF 9 design, vCenter Server, NSX Manager, and Avi Controller VMs
              for this workload domain run on management-domain hosts (VCF-INV-003). Pick which
              mgmt-domain cluster hosts them. NSX Edge nodes can be pinned per-entry below
              (typically run on this workload domain's own hosts). VKS Supervisor runs
              cluster-internal and is unaffected. To pre-existing-appliance placement on
              this WLD's hosts, mark the domain as <strong>Imported (brownfield)</strong> in
              the header.
            </p>
            {placementIssues.length > 0 && (
              <div className="mb-3 border border-rose-300 bg-rose-50 rounded p-3">
                <div className="text-[10px] uppercase tracking-wider text-rose-700 font-mono font-semibold mb-1.5">
                  ⛔ VCF-INV-003 — Placement Violations
                </div>
                <ul className="space-y-1">
                  {placementIssues.map((iss) => (
                    <li key={iss.entryKey} className="text-[11px] text-rose-800 font-mono leading-relaxed">
                      {iss.message}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => update({ imported: true })}
                  className="mt-2 text-[10px] uppercase tracking-wider text-amber-800 font-mono bg-white border border-amber-300 hover:bg-amber-50 rounded px-2 py-1"
                  title="Toggle this workload domain to brownfield (VCF-PATH-004). Pre-existing appliance placement is then permitted."
                >
                  Mark as Imported (brownfield)
                </button>
              </div>
            )}
            <StackPicker
              stack={domain.wldStack || []}
              onChange={(next) => {
                // Tag newly-added entries with ownerDomainId so downstream
                // visibility (injected-appliances panel, PerSiteView Owner
                // column) can identify which WLD owns each appliance. Existing
                // entries keep their tag.
                const tagged = next.map((e) =>
                  e.ownerDomainId ? e : { ...e, ownerDomainId: domain.id }
                );
                update({ wldStack: tagged });
              }}
              isMgmtCluster={false}
              defaultInstancesById={defaultInstancesById}
              allowedPlacements={["per-domain"]}
              mgmtClusters={(eligibleClusters || []).filter((o) => o.scope === "mgmt")}
              wldClusters={(eligibleClusters || []).filter((o) => o.scope === "wld")}
              isImportedDomain={isImported}
              domainDefaultClusterId={selectedId}
              vcfVersion={fleet?.vcfVersion}
            />
          </div>
        );
      })()}

      {domain.clusters.map((c, i) => {
        // Resolve friendly site names for the failover badge so it reads
        // "Site WH200" / "Site ARS" instead of raw ids. Only meaningful when
        // this domain has an explicit 2-site stretch pair.
        const failoverSiteNames =
          domain.placement === "stretched"
            && Array.isArray(domain.stretchSiteIds)
            && domain.stretchSiteIds.length === 2
            ? domain.stretchSiteIds.map((id) => (allSites || []).find((s) => s.id === id)?.name || id)
            : null;
        return (
          <ClusterCard
            key={c.id}
            cluster={c}
            onChange={(next) => updateCluster(i, next)}
            onRemove={() => removeCluster(i)}
            canRemove={domain.clusters.length > 1}
            result={result.clusterResults[i]}
            isMgmtCluster={isMgmt}
            injectedEntries={(injectedByClusterId && injectedByClusterId[c.id]) || []}
            failoverSiteNames={failoverSiteNames}
            domainHostSplitPct={domain.hostSplitPct}
            fleet={fleet}
            instance={instance}
            domain={domain}
          />
        );
      })}

      <button
        onClick={addCluster}
        className="text-[10px] font-mono uppercase tracking-wider text-slate-400 hover:text-emerald-600 border border-dashed border-slate-200 hover:border-emerald-400 rounded px-3 py-1.5 transition-colors"
      >
        + Add Cluster
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCE CARD — VCF instance, contains 1 mgmt + N workload domains
// ─────────────────────────────────────────────────────────────────────────────
function InstanceCard({ instance, allSites, allInstances, onChange, onRemove, canRemove, result, isInitial, canPromote, onPromoteToInitial, fleet }) {
  // True when the instance touches 2 or more sites (potentially stretched).
  // N-site instances (3+) are allowed; the first two sites form the default
  // stretched pair and additional sites host local-only domains unless
  // explicitly moved into a stretch pair via the per-domain picker.
  const isStretchedInstance = (instance.siteIds || []).length >= 2;
  const siteById = (id) => (allSites || []).find((s) => s.id === id);
  const update = (patch) => onChange({ ...instance, ...patch });

  const updateDomain = (idx, next) => {
    onChange({ ...instance, domains: instance.domains.map((d, i) => (i === idx ? next : d)) });
  };
  const addWorkloadDomain = () => {
    const wldCount = instance.domains.filter((d) => d.type === "workload").length;
    const next = newWorkloadDomain(`Workload Domain ${wldCount + 1}`);
    // New workload domains default to being pinned at the instance's first site.
    next.localSiteId = instance.siteIds[0] || null;
    // And their wldStack defaults to being hosted on the mgmt domain's first
    // cluster (VCF 9 default). The user can re-pin via the WLD Components
    // dropdown in the DomainCard.
    const mgmtDom = instance.domains.find((d) => d.type === "mgmt");
    next.componentsClusterId = mgmtDom?.clusters?.[0]?.id || null;
    onChange({ ...instance, domains: [...instance.domains, next] });
  };
  const removeDomain = (idx) => {
    const target = instance.domains[idx];
    if (target.type === "mgmt") return; // mgmt is mandatory
    onChange({ ...instance, domains: instance.domains.filter((_, i) => i !== idx) });
  };

  // Apply a deployment profile — rebuilds the mgmt domain's first cluster stack
  const applyProfile = (profileKey) => {
    const profile = DEPLOYMENT_PROFILES[profileKey];
    if (!profile) return;
    // VCF-INV-011 / VCF-APP-010/012/013/014/020: per-fleet appliances
    // (VCF Operations, Fleet Manager, Logs, Networks Platform, Automation)
    // deploy exactly once across a fleet, on the INITIAL instance's mgmt
    // domain initial cluster. Non-initial instances must carry the same
    // profile minus those per-fleet entries — this is what
    // stackForInstance(profileKey, false) returns.
    const filteredStack = stackForInstance(profileKey, !!isInitial);
    const newStack = filteredStack.map((s) => ({ ...s, key: cryptoKey() }));
    const newDomains = instance.domains.map((d) => {
      if (d.type !== "mgmt") return d;
      const newClusters = d.clusters.map((c, idx) => {
        if (idx !== 0) return c; // only update the default mgmt cluster
        return { ...c, infraStack: newStack };
      });
      return { ...d, clusters: newClusters };
    });
    onChange({ ...instance, deploymentProfile: profileKey, domains: newDomains });
  };

  // Toggle a site's membership in this instance. Supports N sites: the first
  // two form the default stretched pair (preserving legacy 2-site behavior),
  // and sites 3+ host local-only domains unless explicitly opted into a
  // stretch pair via the per-domain picker. Handles placement transitions
  // and re-pins local-domain localSiteIds so they always point at one of
  // the instance's current sites (invariant).
  const toggleSite = (siteId) => {
    const current = instance.siteIds || [];
    let nextIds;
    if (current.includes(siteId)) {
      nextIds = current.filter((id) => id !== siteId);
    } else {
      nextIds = [...current, siteId];
    }
    const becameStretched = current.length < 2 && nextIds.length >= 2;

    const nextDomains = instance.domains.map((d) => {
      if (nextIds.length < 2) {
        // No longer (or never) stretched — force every domain local and
        // pin to the first remaining site (or null if the instance is now
        // orphaned from all sites).
        return {
          ...d,
          placement: "local",
          localSiteId: nextIds[0] || null,
          stretchSiteIds: null,
        };
      }
      // nextIds.length === 2 from here on.
      if (becameStretched && d.type === "mgmt") {
        // 1→2 transition: mgmt domain auto-stretches. localSiteId becomes
        // irrelevant (ignored for stretched placement).
        return {
          ...d,
          placement: "stretched",
          hostSplitPct: getHostSplitPct(d),
          localSiteId: null,
          stretchSiteIds: [nextIds[0], nextIds[1]],
        };
      }
      if (d.placement === "local") {
        // Keep the pin if it still points at a valid site; otherwise fall
        // back to the first remaining site. This is the 2→2 case when one
        // site was swapped for another, or the 1→2 case for workload domains.
        const keep =
          d.localSiteId && nextIds.includes(d.localSiteId) ? d.localSiteId : nextIds[0];
        return { ...d, localSiteId: keep, stretchSiteIds: null };
      }
      // d.placement === "stretched" — reconcile stretchSiteIds with the new
      // site set. If the current pair still sits inside nextIds, keep it;
      // otherwise re-pin to the first two site ids on the instance.
      const prevPair = Array.isArray(d.stretchSiteIds) ? d.stretchSiteIds : [];
      const pairStillValid =
        prevPair.length === 2 && prevPair.every((sid) => nextIds.includes(sid));
      return {
        ...d,
        stretchSiteIds: pairStillValid ? prevPair : [nextIds[0], nextIds[1]],
      };
    });

    onChange({ ...instance, siteIds: nextIds, domains: nextDomains });
  };

  // Swap site order — flips siteIds[0]↔siteIds[1] AND complements every
  // stretched domain's hostSplitPct so the actual physical host distribution
  // is preserved (the swap is a relabeling, not a rebalance).
  const swapSites = () => {
    const ids = instance.siteIds || [];
    if (ids.length !== 2) return;
    const nextDomains = instance.domains.map((d) => {
      if (d.placement !== "stretched") return d;
      const pct = getHostSplitPct(d);
      // If the stretched pair exactly matches the two instance sites, swap
      // their order too — otherwise the stretchSiteIds are already independent
      // of instance ordering (e.g. a 3-site instance where the pair is [A,C]
      // and we swap A↔B). Keep those untouched.
      const prevPair = Array.isArray(d.stretchSiteIds) ? d.stretchSiteIds : null;
      const nextPair =
        prevPair && prevPair.length === 2 && prevPair[0] === ids[0] && prevPair[1] === ids[1]
          ? [ids[1], ids[0]]
          : prevPair;
      return { ...d, hostSplitPct: 100 - pct, stretchSiteIds: nextPair };
    });
    onChange({ ...instance, siteIds: [ids[1], ids[0]], domains: nextDomains });
  };

  const updateWitnessSite = (patch) => {
    update({ witnessSite: { ...(instance.witnessSite || {}), ...patch } });
  };

  const currentProfile = DEPLOYMENT_PROFILES[instance.deploymentProfile] || DEPLOYMENT_PROFILES.ha;

  return (
    <div className="border-l-2 border-sky-300 pl-5 mb-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-sky-700 font-mono font-semibold">
            ▾ VCF INSTANCE
          </span>
          <input
            value={instance.name}
            onChange={(e) => update({ name: e.target.value })}
            className="bg-transparent text-xl text-slate-800 font-serif border-none focus:outline-none focus:bg-slate-50 rounded px-1"
          />
          {isInitial && (
            <span
              className="text-[9px] uppercase tracking-[0.14em] font-mono font-semibold px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-800"
              title="VCF-INV-011: this instance is the fleet's initial instance — per-fleet appliances (VCF Operations, Automation, Fleet Manager, Logs, Networks Platform) live here."
            >
              ★ INITIAL
            </span>
          )}
          {canPromote && onPromoteToInitial && (
            <button
              onClick={onPromoteToInitial}
              className="text-[9px] uppercase tracking-wider text-slate-400 hover:text-amber-700 border border-slate-200 hover:border-amber-400 rounded px-1.5 py-0.5 font-mono"
              title="VCF-INV-011: promote this instance to initial. The fleet's per-fleet appliances (VCF Operations, Automation, Fleet Manager, Logs, Networks Platform) automatically move to this instance's mgmt cluster; the demoted instance's mgmt stack is re-derived without them."
            >
              ↑ Promote to initial
            </button>
          )}
          {instance.drPosture === "warm-standby" && (
            <span
              className="text-[9px] uppercase tracking-[0.14em] font-mono font-semibold px-1.5 py-0.5 rounded border border-violet-300 bg-violet-50 text-violet-800"
              title="VCF-DR-001: this instance is a warm-standby replica. Fleet-level services are dormant until failover (VCF-DR-040)."
            >
              ⛨ WARM STANDBY
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-slate-400 font-mono">
            {result.totalHosts} hosts · {fmt(result.totalCores)} cores · {instance.domains.length} domains
          </span>
          {canRemove && (
            <button
              onClick={onRemove}
              className="text-slate-400 hover:text-rose-600 text-[10px] uppercase tracking-wider px-2 py-0.5 border border-slate-200 rounded"
            >
              Remove Instance
            </button>
          )}
        </div>
      </div>

      {/* Deployment Profile Selector */}
      <div className="border border-sky-200 bg-sky-50 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] uppercase tracking-[0.16em] text-sky-800 font-mono font-semibold">
            Deployment Model
          </span>
          <span className="text-[9px] uppercase tracking-wider text-sky-600 font-mono">
            Per P&P Workbook deployment models
          </span>
        </div>
        <div className="flex gap-2 flex-wrap mb-3">
          {Object.entries(DEPLOYMENT_PROFILES).map(([key, profile]) => (
            <button
              key={key}
              onClick={() => applyProfile(key)}
              className={`text-[11px] font-mono px-3 py-1.5 rounded border transition-colors ${
                instance.deploymentProfile === key
                  ? "bg-sky-600 text-white border-sky-600"
                  : "bg-white text-slate-600 border-slate-200 hover:border-sky-400 hover:text-sky-700"
              }`}
            >
              {profile.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 font-mono leading-relaxed">
          {currentProfile.description}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-slate-400">
          {currentProfile.stack.map((item) => {
            const def = APPLIANCE_DB[item.id];
            if (!def) return null;
            // VCF-INV-011: per-fleet appliances (vcfOps, vcfAuto, fleetMgr,
            // vcfOpsLogs, vcfOpsNet) render only on the initial instance.
            // On non-initial instances they're crossed out in the preview so
            // the user can SEE they've been filtered (not silently dropped).
            const isPerFleet = def.scope === "per-fleet";
            const filteredOut = isPerFleet && !isInitial;
            return (
              <span
                key={item.id}
                className={filteredOut ? "line-through text-slate-300" : ""}
                title={filteredOut
                  ? `${def.label} is scope=per-fleet (${def.ruleId}); lives only on the initial instance per VCF-INV-011. Not added to this stack.`
                  : isPerFleet
                    ? `${def.label} is scope=per-fleet (${def.ruleId}) — this is the initial instance, so it lives here.`
                    : def.label}
              >
                {def.label} <span className="text-slate-600">×{item.instances}</span>
              </span>
            );
          })}
        </div>
        {!isInitial && currentProfile.stack.some((item) => APPLIANCE_DB[item.id]?.scope === "per-fleet") && (
          <p className="mt-1 text-[10px] font-mono text-amber-700 italic">
            ★ This is a non-initial instance — per-fleet appliances (struck through) are hosted on the initial instance per VCF-INV-011.
          </p>
        )}
        {/* DR posture + pair picker — VCF-DR-001..050 */}
        <div className="mt-3 pt-3 border-t border-sky-200 flex items-center gap-3 flex-wrap">
          <label className="text-[10px] uppercase tracking-[0.14em] text-sky-800 font-mono font-semibold">
            DR Posture
          </label>
          <select
            value={instance.drPosture || "active"}
            onChange={(e) => update({ drPosture: e.target.value, drPairedInstanceId: e.target.value === "active" ? null : instance.drPairedInstanceId })}
            className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1 text-slate-700 focus:outline-none focus:border-violet-400"
            title="VCF-DR-001: declare this instance's steady-state role. Warm-standby instances carry replicated fleet services that activate only on failover."
          >
            {Object.entries(DR_POSTURES).map(([key, def]) => (
              <option key={key} value={key}>{def.label}{def.ruleId ? ` (${def.ruleId})` : ""}</option>
            ))}
          </select>
          {instance.drPosture === "warm-standby" && (
            <>
              <label className="text-[10px] uppercase tracking-[0.14em] text-sky-800 font-mono">Paired With</label>
              <select
                value={instance.drPairedInstanceId || ""}
                onChange={(e) => update({ drPairedInstanceId: e.target.value || null })}
                className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1 text-slate-700 focus:outline-none focus:border-violet-400"
              >
                <option value="">— select primary —</option>
                {(allInstances || []).filter((x) => x.id !== instance.id).map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
              <span className="text-[10px] text-violet-700 font-mono italic">
                Replicated via VLR: {DR_REPLICATED_COMPONENTS.join(", ")} · Backup/restore: {DR_BACKUP_COMPONENTS.join(", ")}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Site Membership */}
      <div className="border border-slate-200 bg-white rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] uppercase tracking-[0.16em] text-slate-700 font-mono font-semibold">
            Sites this instance touches
          </span>
          {isStretchedInstance && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 font-mono">
                {(instance.siteIds || []).length === 2
                  ? `${siteById(instance.siteIds[0])?.name || "Site A"} ↔ ${siteById(instance.siteIds[1])?.name || "Site B"}`
                  : `${(instance.siteIds || []).length} sites`}
              </span>
              {(instance.siteIds || []).length === 2 && (
                <button
                  onClick={swapSites}
                  title="Swap site order — flips host-split direction without moving hosts"
                  className="text-[9px] uppercase tracking-wider text-slate-400 hover:text-blue-600 border border-slate-200 hover:border-blue-400 rounded px-2 py-0.5 transition-colors font-mono"
                >
                  ⇄ Swap
                </button>
              )}
            </div>
          )}
        </div>
        <p className="text-[10px] text-slate-500 font-mono mb-3 leading-relaxed">
          Select one or more sites. One site = single-site deployment. Two or more sites =
          multi-site deployment under ONE shared SDDC Manager / vCenter control plane. The
          first two selected sites form the default stretched pair for the Mgmt domain;
          additional sites host local workload domains (remote-managed from the primary).
          Per-domain placement (local @ site, or stretched A↔B) is chosen below.
        </p>
        {(allSites || []).length === 0 ? (
          <p className="text-[10px] text-rose-600 font-mono mb-3">
            Add a site to the fleet first.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 mb-3">
            {(allSites || []).map((s) => {
              const checked = (instance.siteIds || []).includes(s.id);
              const disabled = false;
              return (
                <label
                  key={s.id}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded border text-[11px] font-mono ${
                    checked
                      ? "bg-blue-50 border-blue-300 text-slate-800"
                      : disabled
                        ? "bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed"
                        : "bg-white border-slate-200 text-slate-600 hover:border-blue-300 cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleSite(s.id)}
                    className="accent-blue-600"
                  />
                  <span className="truncate">
                    {s.name}{s.location ? <span className="text-slate-400"> · {s.location}</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {isStretchedInstance && (
          <>
            <p className="text-[10px] text-slate-500 font-mono leading-relaxed mb-3">
              Multi-site VCF instances run under ONE shared SDDC Manager / vCenter control plane.
              A stretched pair between two of the selected sites uses synchronous storage
              replication — either vSAN stretched cluster (requires a witness at a third fault
              domain) or array-based synchronous replication (FC/iSCSI with vendor-specific
              replication such as Dell SRDF, Pure ActiveCluster, or NetApp MetroCluster). Stretched
              pairs require L2 network stretch via NSX. Additional sites beyond the stretch pair
              host local (non-replicated) workload domains that this instance manages remotely.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <TextField
                label="Witness Site Name"
                value={instance.witnessSite?.name || ""}
                onChange={(v) => updateWitnessSite({ name: v })}
                placeholder="e.g. Cloud Witness"
              />
              <TextField
                label="Witness Location"
                value={instance.witnessSite?.location || ""}
                onChange={(v) => updateWitnessSite({ location: v })}
                placeholder="e.g. Azure East US"
              />
            </div>
            {/* VCF-APP-080: optionally reference a fleet site (siteRole=witness) instead. */}
            {(() => {
              const witnessSites = (allSites || []).filter((s) => s.siteRole === "witness");
              if (witnessSites.length === 0) return (
                <p className="text-[10px] text-slate-400 font-mono italic mb-3">
                  Tip: add a site with role "Witness" in the Sites panel to share one physical witness across instances.
                </p>
              );
              return (
                <div className="mb-3 flex items-center gap-2">
                  <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono">
                    Use fleet witness site
                  </label>
                  <select
                    value={instance.witnessSiteId || ""}
                    onChange={(e) => update({ witnessSiteId: e.target.value || null })}
                    className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1 text-slate-700"
                  >
                    <option value="">— standalone (free-form above) —</option>
                    {witnessSites.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.location || "unspecified"})</option>
                    ))}
                  </select>
                </div>
              );
            })()}

            {/* Witness Appliance Sizing */}
            {(() => {
              const stretchedDomains = instance.domains.filter(
                (d) => d.placement === "stretched"
                  && Array.isArray(d.stretchSiteIds)
                  && d.stretchSiteIds.length === 2
              );
              const stretchedClusterCount = stretchedDomains.reduce((s, d) => s + d.clusters.length, 0);
              if (stretchedClusterCount === 0) return null;
              const wDef = APPLIANCE_DB.vsanWitness;
              const wSz = wDef?.sizes[instance.witnessSize || "Medium"] || wDef?.sizes.Medium;
              const totalWitnesses = stretchedClusterCount;
              const witnessEnabled = instance.witnessEnabled !== false; // default true

              return (
                <div className={`border rounded-lg mb-3 transition-colors ${witnessEnabled ? "border-yellow-300 bg-yellow-50" : "border-slate-200 bg-slate-50"}`}>
                  {/* Header with storage method toggle — always visible */}
                  <div className="flex items-center justify-between p-3 border-b border-current border-opacity-20">
                    <div className="flex items-center gap-3">
                      <span className={`text-[11px] uppercase tracking-[0.14em] font-mono font-semibold ${witnessEnabled ? "text-yellow-800" : "text-slate-600"}`}>
                        ⬦ Storage Replication Method
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => update({ witnessEnabled: true })}
                        className={`text-[10px] font-mono px-3 py-1 rounded border transition-colors ${witnessEnabled ? "bg-yellow-600 text-white border-yellow-600" : "bg-white text-slate-500 border-slate-300 hover:border-yellow-400"}`}
                      >
                        vSAN Stretched (witness req'd)
                      </button>
                      <button
                        onClick={() => update({ witnessEnabled: false })}
                        className={`text-[10px] font-mono px-3 py-1 rounded border transition-colors ${!witnessEnabled ? "bg-slate-600 text-white border-slate-600" : "bg-white text-slate-500 border-slate-300 hover:border-slate-400"}`}
                      >
                        Array-based (no witness)
                      </button>
                    </div>
                  </div>

                  {witnessEnabled && wSz ? (
                    <div className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] uppercase tracking-[0.14em] text-yellow-800 font-mono font-semibold">
                          vSAN Witness Host Requirements
                        </span>
                        <span className="text-[10px] text-yellow-700 font-mono">
                          {totalWitnesses} witness{totalWitnesses !== 1 ? "es" : ""} needed · Deployed at {instance.witnessSite?.name || "witness site"}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-3 items-end mb-2">
                        <div>
                          <span className="block text-[10px] uppercase tracking-[0.14em] text-yellow-700 mb-1 font-medium font-mono">
                            Appliance Size
                          </span>
                          <select
                            value={instance.witnessSize || "Medium"}
                            onChange={(e) => update({ witnessSize: e.target.value })}
                            className="w-full bg-white border border-yellow-300 rounded px-2 py-1.5 text-slate-800 font-mono text-sm focus:outline-none focus:border-yellow-500"
                          >
                            {Object.entries(wDef.sizes).map(([k, v]) => (
                              <option key={k} value={k}>{k} — {v.note}</option>
                            ))}
                          </select>
                        </div>
                        <div className="text-center">
                          <span className="block text-[10px] text-yellow-700 font-mono mb-1">Per Witness</span>
                          <span className="text-sm font-mono text-yellow-900">{wSz.vcpu} vCPU · {wSz.ram} GB · {wSz.disk} GB</span>
                        </div>
                        <div className="text-center">
                          <span className="block text-[10px] text-yellow-700 font-mono mb-1">Count</span>
                          <span className="text-sm font-mono text-yellow-900">×{totalWitnesses}</span>
                        </div>
                        <div className="text-center">
                          <span className="block text-[10px] text-yellow-700 font-mono mb-1">Total at Witness Site</span>
                          <span className="text-sm font-mono text-yellow-900 font-semibold">
                            {wSz.vcpu * totalWitnesses} vCPU · {wSz.ram * totalWitnesses} GB · {wSz.disk * totalWitnesses} GB
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] text-yellow-700 font-mono">
                        {wDef.info}
                      </p>
                    </div>
                  ) : (
                    <div className="p-3">
                      <p className="text-[11px] text-slate-600 font-mono leading-relaxed">
                        <strong>Array-based synchronous replication selected.</strong> No vSAN witness host required —
                        quorum and failover are handled by the storage array (e.g. Dell PowerMax SRDF/Metro, Pure
                        ActiveCluster, NetApp MetroCluster, HPE Peer Persistence). Ensure your storage vendor's
                        active/active configuration is certified with VCF 9 and that VMFS datastores are presented
                        identically to hosts at both sites.
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="bg-blue-50 border border-blue-200 rounded p-2">
              <span className="text-[10px] text-blue-800 font-mono font-semibold uppercase tracking-wider">
                Domain Placement
              </span>
              <p className="text-[10px] text-blue-700 font-mono mt-1">
                Each domain below can be set to <strong>Local</strong> (runs at one site only) or{" "}
                <strong>Stretched</strong> (spans a pair of sites via synchronous storage replication).
                The management domain auto-stretched across the first two sites you added. Workload
                domains default to Local — toggle individually. When the instance touches 3+ sites,
                each stretched domain declares its own pair (primary ↔ secondary) and local domains
                pin to any one site.
              </p>
            </div>
          </>
        )}
      </div>

      {(() => {
        // Precompute context shared across every DomainCard in this instance:
        //
        //   defaultInstancesById — "HA default" instance counts per appliance,
        //     derived from the instance's deploymentProfile. Adding an nsxMgr
        //     to a WLD wldStack on an HA-profile instance should default to 3,
        //     not 1. Non-profile appliances fall back to 1 at StackPicker time.
        //
        //   injectedByClusterId — the authoritative "which cluster hosts which
        //     WLD appliances" map. This mirrors sizeInstance's extraByClusterId
        //     fallback logic so the UI cannot drift from the sizing math: both
        //     walk mgmt domain's first cluster if componentsClusterId is unset
        //     or invalid. Each injected entry carries the owning domain's id
        //     and name so ClusterCard can label it without walking the fleet.
        const profileStack =
          DEPLOYMENT_PROFILES[instance.deploymentProfile]?.stack || [];
        const defaultInstancesById = {};
        for (const entry of profileStack) {
          defaultInstancesById[entry.id] = entry.instances;
        }

        const mgmtDom = instance.domains.find((x) => x.type === "mgmt");
        const clusterById = {};
        for (const dom of instance.domains || []) {
          for (const c of dom.clusters || []) clusterById[c.id] = c;
        }
        const mgmtFirst = mgmtDom?.clusters?.[0];
        // Per-entry placement (Plan 1) — each wldStack entry can override
        // the domain default via entry.placementClusterId. Resolution order:
        //   1. entry.placementClusterId (per-entry override; e.g. NSX Edge
        //      pinned to a WLD cluster while vCenter stays on mgmt)
        //   2. dom.componentsClusterId (per-domain default)
        //   3. mgmt domain's first cluster (fleet-wide fallback)
        // This mirrors engine.sizeInstance's extraByClusterId resolution so
        // the UI cannot drift from the sizing math.
        const injectedByClusterId = {};
        for (const dom of instance.domains || []) {
          if (dom.type !== "workload") continue;
          const wld = dom.wldStack || [];
          if (wld.length === 0) continue;
          const domainTarget = clusterById[dom.componentsClusterId] || mgmtFirst;
          for (const e of wld) {
            const target = clusterById[e.placementClusterId] || domainTarget;
            if (!target) continue;
            injectedByClusterId[target.id] = [
              ...(injectedByClusterId[target.id] || []),
              {
                ...e,
                ownerDomainId: e.ownerDomainId || dom.id,
                ownerDomainName: dom.name,
              },
            ];
          }
        }

        return instance.domains.map((d, i) => {
          // Workload domains can host their wldStack on any cluster in the
          // mgmt domain OR on any of their own clusters. Mgmt domains don't
          // render the picker so the eligible list is unused for them.
          const eligibleClusters =
            d.type === "workload"
              ? [
                  ...((mgmtDom?.clusters || []).map((c) => ({
                    id: c.id,
                    label: `${mgmtDom.name} / ${c.name}`,
                    scope: "mgmt",
                  }))),
                  ...((d.clusters || []).map((c) => ({
                    id: c.id,
                    label: `${d.name} / ${c.name}`,
                    scope: "wld",
                  }))),
                ]
              : [];
          return (
            <DomainCard
              key={d.id}
              domain={d}
              isStretched={isStretchedInstance}
              instanceSiteIds={instance.siteIds || []}
              allSites={allSites}
              eligibleClusters={eligibleClusters}
              defaultInstancesById={defaultInstancesById}
              injectedByClusterId={injectedByClusterId}
              onChange={(next) => updateDomain(i, next)}
              onRemove={() => removeDomain(i)}
              canRemove={d.type !== "mgmt"}
              fleet={fleet}
              instance={instance}
              result={result.domainResults[i]}
            />
          );
        });
      })()}

      <button
        onClick={addWorkloadDomain}
        className="text-[10px] font-mono uppercase tracking-wider text-slate-400 hover:text-rose-600 border border-dashed border-slate-200 hover:border-rose-400 rounded px-3 py-1.5 transition-colors"
      >
        + Add Workload Domain
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SITES PANEL — flat CRUD for fleet.sites with referential-integrity guard
// ─────────────────────────────────────────────────────────────────────────────
function SitesPanel({ fleet, onChange }) {
  const updateSite = (idx, patch) => {
    onChange({
      ...fleet,
      sites: fleet.sites.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    });
  };
  const addSite = () => {
    onChange({
      ...fleet,
      sites: [...fleet.sites, newSite(`Site ${fleet.sites.length + 1}`)],
    });
  };
  const removeSite = (idx) => {
    const target = fleet.sites[idx];
    const blockers = fleet.instances.filter((inst) => (inst.siteIds || []).includes(target.id));
    if (blockers.length > 0) {
      alert(
        `Cannot delete "${target.name}" — referenced by ${blockers.length} instance${blockers.length === 1 ? "" : "s"}: ${blockers.map((i) => i.name).join(", ")}.\n\nUntick this site from those instances first.`
      );
      return;
    }
    onChange({ ...fleet, sites: fleet.sites.filter((_, i) => i !== idx) });
  };

  return (
    <div className="border border-slate-200 bg-white shadow-sm rounded-lg p-5 mb-5">
      <div className="flex items-baseline justify-between border-b border-slate-200 pb-2 mb-4">
        <h2 className="font-serif text-2xl text-slate-900">Sites</h2>
        <span className="text-[10px] uppercase tracking-[0.2em] text-blue-600 font-mono">
          {fleet.sites.length} site{fleet.sites.length === 1 ? "" : "s"} · physical locations only
        </span>
      </div>
      <p className="text-[11px] text-slate-500 font-mono mb-4 leading-relaxed">
        Sites are pure location metadata. VCF instances reference sites by id and can
        span two sites (stretched). Delete is blocked while any instance still references a site.
      </p>
      {fleet.sites.length === 0 ? (
        <p className="text-[11px] text-slate-400 font-mono mb-3">
          No sites yet. Add at least one site before placing VCF instances.
        </p>
      ) : (
        <div className="space-y-2 mb-3">
          {fleet.sites.map((s, i) => {
            const refCount = fleet.instances.filter((inst) => (inst.siteIds || []).includes(s.id)).length;
            return (
              <div key={s.id} className="flex items-center gap-3 border border-slate-200 rounded px-3 py-2">
                <span className="text-[11px] uppercase tracking-[0.16em] text-blue-600 font-mono font-semibold">
                  ◼
                </span>
                <input
                  value={s.name}
                  onChange={(e) => updateSite(i, { name: e.target.value })}
                  className="flex-1 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-500 focus:outline-none text-base font-serif text-slate-800 px-1 py-0.5"
                  placeholder="Site name"
                />
                <input
                  value={s.location || ""}
                  onChange={(e) => updateSite(i, { location: e.target.value })}
                  className="flex-1 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-500 focus:outline-none text-sm font-mono text-slate-500 px-1 py-0.5"
                  placeholder="Location (e.g. Dallas, TX)"
                />
                <input
                  value={s.region || ""}
                  onChange={(e) => updateSite(i, { region: e.target.value })}
                  className="w-28 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-500 focus:outline-none text-xs font-mono text-slate-500 px-1 py-0.5"
                  placeholder="Region"
                  title="VCF-TOPO-004: optional region grouping for multi-region fleets. Informational."
                />
                <select
                  value={s.siteRole || ""}
                  onChange={(e) => updateSite(i, { siteRole: e.target.value })}
                  className="text-[10px] font-mono bg-white border border-slate-200 rounded px-1 py-0.5 text-slate-700"
                  title="Optional site role. Primary = steady-state site; DR = disaster-recovery target; Witness = third fault domain for vSAN stretched clusters."
                >
                  <option value="">—</option>
                  <option value="primary">Primary</option>
                  <option value="dr">DR</option>
                  <option value="witness">Witness</option>
                </select>
                <span className="text-[10px] text-slate-400 font-mono w-28 text-right">
                  {refCount} instance{refCount === 1 ? "" : "s"}
                </span>
                <button
                  onClick={() => removeSite(i)}
                  className={`text-[10px] uppercase tracking-wider px-2 py-0.5 border rounded ${
                    refCount > 0
                      ? "text-slate-300 border-slate-200 cursor-help"
                      : "text-slate-400 hover:text-rose-600 border-slate-200 hover:border-rose-300"
                  }`}
                  title={refCount > 0 ? `Referenced by ${refCount} instance(s) — untick this site from those instances first` : "Delete site"}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
      <button
        onClick={addSite}
        className="w-full border border-dashed border-slate-200 hover:border-blue-400 hover:text-blue-600 text-slate-400 rounded py-2 transition-colors text-[11px] uppercase tracking-[0.18em] font-mono"
      >
        + Add Site
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCES PANEL — flat list of fleet.instances, each rendered once
// regardless of how many sites it touches (the v5 fix)
// ─────────────────────────────────────────────────────────────────────────────
function InstancesPanel({ fleet, fleetResult, onChange }) {
  const updateInstance = (idx, next) => {
    onChange({
      ...fleet,
      instances: fleet.instances.map((inst, i) => (i === idx ? next : inst)),
    });
  };
  const addInstance = () => {
    const defaultSiteIds = fleet.sites.length > 0 ? [fleet.sites[0].id] : [];
    onChange({
      ...fleet,
      instances: [
        ...fleet.instances,
        newInstance(`vcf-instance-${fleet.instances.length + 1}`, defaultSiteIds),
      ],
    });
  };
  const removeInstance = (idx) => {
    onChange({ ...fleet, instances: fleet.instances.filter((_, i) => i !== idx) });
  };

  return (
    <div className="border border-slate-200 bg-white shadow-sm rounded-lg p-5 mb-5">
      <div className="flex items-baseline justify-between border-b border-slate-200 pb-2 mb-4">
        <h2 className="font-serif text-2xl text-slate-900">VCF Instances</h2>
        <span className="text-[10px] uppercase tracking-[0.2em] text-sky-700 font-mono">
          {fleet.instances.length} instance{fleet.instances.length === 1 ? "" : "s"} · appliance stacks + domains
        </span>
      </div>
      {fleet.instances.length === 0 && (
        <p className="text-[11px] text-slate-400 font-mono mb-3">
          No instances yet. Add a VCF instance to start placing domains and clusters.
        </p>
      )}
      {fleet.instances.map((inst, i) => (
        <InstanceCard
          key={inst.id}
          instance={inst}
          allSites={fleet.sites}
          allInstances={fleet.instances}
          onChange={(next) => updateInstance(i, next)}
          onRemove={() => removeInstance(i)}
          canRemove={fleet.instances.length > 1}
          result={fleetResult.instanceResults[i]}
          isInitial={i === 0}
          canPromote={i > 0}
          onPromoteToInitial={() => onChange(promoteToInitial(fleet, inst.id))}
          fleet={fleet}
        />
      ))}
      <button
        onClick={addInstance}
        className="text-[10px] font-mono uppercase tracking-wider text-slate-400 hover:text-sky-700 border border-dashed border-slate-200 hover:border-sky-400 rounded px-3 py-1.5 transition-colors"
      >
        + Add VCF Instance
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOPOLOGY VIEW — auto-generated SVG diagram of the entire fleet
// Layout: horizontal tree, left-to-right. Columns are hierarchy levels.
// Each leaf cluster gets its own row; internal nodes are vertically centered
// over their children.
// ─────────────────────────────────────────────────────────────────────────────
function TopologyView({ fleet, fleetResult, setFleet }) {
  const [topoView, setTopoView] = useState("logical");
  const [showMermaid, setShowMermaid] = useState(false);
  const [mermaidCopied, setMermaidCopied] = useState(false);

  const logicalLayout = useMemo(() => {
    try {
      return computeTopologyLayout(fleet, fleetResult);
    } catch (err) {
      // Topology layout error silenced for production
      return { boxes: [], connectors: [], stretchedConnectors: [], width: 400, height: 100, _error: err.message };
    }
  }, [fleet, fleetResult]);

  const physicalLayout = useMemo(() => {
    try {
      return computePhysicalLayout(fleet, fleetResult);
    } catch (err) {
      // Physical layout error silenced for production
      return { sites: [], stretchedBands: [], witnesses: [], width: 400, height: 100, _error: err.message };
    }
  }, [fleet, fleetResult]);

  const activeLayout = topoView === "logical" ? logicalLayout : physicalLayout;

  const exportDrawio = () => {
    const xml = generateDrawioXml(activeLayout, topoView);
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(xml, `vcf-topology-${topoView}-${date}.drawio`, "application/xml");
  };

  const handleCopyMermaid = () => {
    const code = generateMermaidCode(activeLayout, topoView);
    navigator.clipboard.writeText(code).then(() => {
      setMermaidCopied(true);
      setTimeout(() => setMermaidCopied(false), 2000);
    });
  };

  if (logicalLayout._error && topoView === "logical") {
    return (
      <div className="border border-rose-300 bg-rose-50 rounded-lg p-5">
        <h2 className="font-serif text-xl text-rose-900 mb-2">Topology rendering error</h2>
        <p className="text-sm text-rose-700 font-mono">{logicalLayout._error}</p>
        <p className="text-xs text-rose-600 font-mono mt-2">
          Check the browser console for details. This usually indicates a stretched-cluster
          configuration referencing a site that no longer exists, or a domain missing required fields.
        </p>
      </div>
    );
  }

  const SubTabBtn = ({ value, children }) => (
    <button
      onClick={() => setTopoView(value)}
      className={`text-[10px] uppercase tracking-wider font-mono px-3 py-1.5 rounded border ${
        topoView === value
          ? "bg-blue-600 text-white border-blue-600"
          : "text-slate-600 border-slate-200 hover:border-blue-400 hover:text-blue-600"
      }`}
    >{children}</button>
  );

  return (
    <div className="border border-blue-200 bg-white rounded-lg p-5">
      <div className="flex items-center justify-between border-b border-blue-200 pb-2 mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h2 className="font-serif text-2xl text-slate-900">Fleet Topology</h2>
          <div className="flex gap-1">
            <SubTabBtn value="logical">Logical</SubTabBtn>
            <SubTabBtn value="physical">Physical</SubTabBtn>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportDrawio}
            className="text-[10px] uppercase tracking-wider font-mono text-slate-600 border border-slate-200 hover:border-blue-400 hover:text-blue-600 rounded px-3 py-1.5">
            Export draw.io
          </button>
          <button onClick={() => setShowMermaid(true)}
            className="text-[10px] uppercase tracking-wider font-mono text-slate-600 border border-slate-200 hover:border-blue-400 hover:text-blue-600 rounded px-3 py-1.5">
            Copy Mermaid
          </button>
        </div>
      </div>

      {topoView === "logical" ? (
        <>
          <div className="overflow-auto bg-slate-50 rounded border border-slate-200 p-4">
            <svg
              width={logicalLayout.width}
              height={logicalLayout.height}
              xmlns="http://www.w3.org/2000/svg"
              style={{ minWidth: "100%" }}
            >
              {logicalLayout.connectors.map((conn, i) => (
                <TopologyConnector key={`c-${i}`} from={conn.from} to={conn.to} />
              ))}
              {(logicalLayout.stretchedConnectors || []).map((conn, i) => (
                <TopologyConnector key={`sc-${i}`} from={conn.from} to={conn.to} dashed kind={conn.kind} />
              ))}
              {logicalLayout.boxes.map((box) => (
                <TopologyBox key={box.id} box={box} />
              ))}
            </svg>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[10px] font-mono text-slate-400">
            <LegendChip color="#2563eb" label="Fleet" />
            <LegendChip color="#475569" label="Site" />
            <LegendChip color="#0284c7" label="VCF Instance" />
            <LegendChip color="#7c3aed" label="Mgmt Domain" />
            <LegendChip color="#e11d48" label="Workload Domain" />
            <LegendChip color="#16a34a" label="Cluster" />
            <LegendChip color="#ca8a04" label="Witness (vSAN)" />
            <span className="flex items-center gap-1.5">
              <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="4 2" /></svg>
              <span>Stretched</span>
            </span>
          </div>
          <FleetOverlayPanels fleet={fleet} />
        </>
      ) : (
        <>
          <PhysicalTopologyView fleet={fleet} fleetResult={fleetResult} setFleet={setFleet} />
          <div className="mt-3 flex flex-wrap gap-3 text-[10px] font-mono text-slate-400">
            <LegendChip color="#475569" label="Site" />
            <LegendChip color="#7c3aed" label="Mgmt Domain" />
            <LegendChip color="#e11d48" label="Workload Domain" />
            <LegendChip color="#16a34a" label="Cluster" />
            <LegendChip color="#64748b" label="Appliance" />
            <LegendChip color="#ca8a04" label="Witness" />
            <LegendChip color="#7e22ce" label="Warm Standby" />
            <LegendChip color="#0ea5e9" label="T0 Gateway" />
            <span className="flex items-center gap-1.5">
              <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="4 2" /></svg>
              <span>Stretched</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-flex gap-0.5">
                <span className="w-2 h-2 rounded-full bg-green-600"></span>
                <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                <span className="w-2 h-2 rounded-full bg-red-600"></span>
              </span>
              <span>Failover</span>
            </span>
          </div>
          <FleetOverlayPanels fleet={fleet} />
        </>
      )}

      {/* Mermaid code modal */}
      {showMermaid && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setShowMermaid(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-serif text-lg text-slate-900">
                Mermaid Diagram Code ({topoView === "logical" ? "Logical" : "Physical"})
              </h3>
              <button onClick={() => setShowMermaid(false)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
            </div>
            <div className="p-5 flex-1 overflow-auto">
              <textarea readOnly
                value={generateMermaidCode(activeLayout, topoView)}
                className="w-full h-64 font-mono text-xs bg-slate-50 border border-slate-200 rounded p-3 resize-none"
              />
              <p className="text-xs text-slate-400 mt-2 font-mono">
                Paste into mermaid.live or a GitHub markdown block to render the diagram.
              </p>
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2">
              <button onClick={handleCopyMermaid}
                className="text-[10px] uppercase tracking-wider font-mono text-white bg-blue-600 hover:bg-blue-700 rounded px-4 py-2">
                {mermaidCopied ? "Copied!" : "Copy to Clipboard"}
              </button>
              <button onClick={() => setShowMermaid(false)}
                className="text-[10px] uppercase tracking-wider font-mono text-slate-600 border border-slate-200 hover:border-slate-400 rounded px-4 py-2">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const LegendChip = memo(function LegendChip({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block w-2.5 h-2.5 rounded-sm"
        style={{ background: color }}
      />
      <span>{label}</span>
    </div>
  );
});

// Overlay panels rendered under the logical topology SVG: summarize T0
// gateways, SSO topology, DR pairs, and NSX Federation links. Complements
// the SVG tree by surfacing cross-cluster relationships the tree can't
// easily show.
function FleetOverlayPanels({ fleet }) {
  const instById = Object.fromEntries((fleet.instances || []).map((i) => [i.id, i]));

  // T0 inventory per cluster (ClusterCard shows inline validator; this is a
  // fleet-wide rollup).
  const t0Rows = [];
  for (const inst of fleet.instances || []) {
    for (const dom of inst.domains || []) {
      for (const clu of dom.clusters || []) {
        for (const t0 of (clu.t0Gateways || [])) {
          t0Rows.push({ inst, dom, clu, t0 });
        }
      }
    }
  }

  const drPairs = (fleet.instances || [])
    .filter((i) => i.drPosture === "warm-standby" && i.drPairedInstanceId)
    .map((secondary) => ({ secondary, primary: instById[secondary.drPairedInstanceId] }))
    .filter((p) => p.primary);

  const federationMembers = fleet.federationEnabled
    ? (fleet.instances || []).filter((i) => {
        for (const dom of i.domains || []) {
          for (const clu of dom.clusters || []) {
            if ((clu.infraStack || []).some((e) => e.id === "nsxGlobalMgr")) return true;
          }
        }
        return false;
      })
    : [];

  const ssoMode = fleet.ssoMode || "embedded";
  const ssoBrokers = fleet.ssoBrokers || [];

  return (
    <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      {/* T0 Gateways */}
      <div className="border border-slate-200 rounded p-3 bg-slate-50">
        <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono font-semibold mb-2">
          T0 Gateways ({t0Rows.length})
        </div>
        {t0Rows.length === 0 ? (
          <p className="text-[10px] text-slate-400 font-mono italic">No T0 gateways declared.</p>
        ) : (
          <ul className="space-y-1">
            {t0Rows.map(({ clu, t0 }) => (
              <li key={`${clu.id}-${t0.id}`} className="text-[10px] font-mono text-slate-700">
                <span className="font-semibold">{t0.name}</span>{" "}
                <span className="text-slate-400">· {t0.haMode}</span>{" "}
                <span className="text-slate-400">· {(t0.edgeNodeKeys || []).length} edge</span>
                {t0.stateful && <span className="text-amber-700"> · stateful</span>}
                {t0.bgpEnabled && <span className="text-blue-700"> · BGP</span>}
                {(t0.featureRequirements || []).length > 0 && (
                  <span className="text-emerald-700"> · {(t0.featureRequirements || []).join("/")}</span>
                )}
                <div className="text-slate-400">on {clu.name}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* SSO Topology */}
      <div className="border border-slate-200 rounded p-3 bg-slate-50">
        <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono font-semibold mb-2">
          SSO Topology
        </div>
        <p className="text-[10px] font-mono text-slate-700 mb-1">
          Mode: <span className="font-semibold">{ssoMode}</span>
        </p>
        {ssoMode === "multi-broker" && ssoBrokers.length > 0 ? (
          <ul className="space-y-1">
            {ssoBrokers.map((b) => (
              <li key={b.id} className="text-[10px] font-mono text-slate-700">
                <span className="font-semibold">{b.name || b.id}</span>
                <span className="text-slate-400"> — serves {(b.servesInstanceIds || []).length} instance(s)</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[10px] text-slate-400 font-mono italic">
            {ssoMode === "embedded" ? "Per-instance embedded brokers." : "Single fleet-wide broker on the initial instance."}
          </p>
        )}
        {fleet.ssoFleetServicesBrokerId && (
          <p className="text-[10px] font-mono text-slate-500 mt-1">
            Fleet services bound to: <span className="font-semibold">{fleet.ssoFleetServicesBrokerId}</span>
          </p>
        )}
      </div>

      {/* DR Pairs */}
      <div className="border border-slate-200 rounded p-3 bg-slate-50">
        <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono font-semibold mb-2">
          DR Pairs ({drPairs.length})
        </div>
        {drPairs.length === 0 ? (
          <p className="text-[10px] text-slate-400 font-mono italic">No warm-standby pairings.</p>
        ) : (
          <ul className="space-y-1">
            {drPairs.map(({ primary, secondary }) => (
              <li key={secondary.id} className="text-[10px] font-mono text-slate-700">
                <span className="font-semibold">{primary.name}</span>
                <span className="text-violet-600"> → </span>
                <span className="font-semibold">{secondary.name}</span>
                <span className="text-slate-400"> (warm standby)</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Federation */}
      <div className="border border-slate-200 rounded p-3 bg-slate-50">
        <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono font-semibold mb-2">
          NSX Federation
        </div>
        {!fleet.federationEnabled ? (
          <p className="text-[10px] text-slate-400 font-mono italic">Not enabled.</p>
        ) : federationMembers.length === 0 ? (
          <p className="text-[10px] text-amber-700 font-mono italic">
            Flag set but no instance carries nsxGlobalMgr — check stacks.
          </p>
        ) : (
          <ul className="space-y-1">
            {federationMembers.map((i, idx) => (
              <li key={i.id} className="text-[10px] font-mono text-slate-700">
                <span className="font-semibold">{i.name}</span>
                <span className="text-slate-400"> · {idx === 0 ? "active GM" : "standby GM"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const TOPOLOGY_COLORS = {
  fleet:     { fill: "#eff6ff", stroke: "#2563eb", text: "#1e3a5f" },
  site:      { fill: "#f8fafc", stroke: "#475569", text: "#1e3a5f" },
  instance:  { fill: "#f0f9ff", stroke: "#0284c7", text: "#0c4a6e" },
  mgmt:      { fill: "#f5f3ff", stroke: "#7c3aed", text: "#4c1d95" },
  workload:  { fill: "#fff1f2", stroke: "#e11d48", text: "#881337" },
  cluster:   { fill: "#f0fdf4", stroke: "#16a34a", text: "#14532d" },
  witness:   { fill: "#fefce8", stroke: "#ca8a04", text: "#713f12" },
  appliance: { fill: "#f0f9ff", stroke: "#64748b", text: "#334155" },
};

function TopologyBox({ box }) {
  const c = TOPOLOGY_COLORS[box.kind] || TOPOLOGY_COLORS.cluster;

  // Witness boxes are smaller and simpler
  if (box.kind === "witness") {
    return (
      <g>
        <rect
          x={box.x} y={box.y} width={box.width} height={box.height}
          rx={3} fill={c.fill} stroke={c.stroke} strokeWidth={1} strokeDasharray="4 2"
        />
        <text x={box.x + 8} y={box.y + 18} fontFamily="IBM Plex Mono, monospace"
          fontSize={9} fill={c.text} fontWeight="500">
          {truncate(box.label, 34)}
        </text>
      </g>
    );
  }

  return (
    <g>
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={4}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={1.5}
      />
      <text
        x={box.x + 10}
        y={box.y + 22}
        fontFamily="Inter, system-ui, sans-serif"
        fontSize={14}
        fontWeight="600"
        fill={c.text}
      >
        {truncate(box.label, 30)}
      </text>
      {box.subtitle && (
        <text
          x={box.x + 10}
          y={box.y + 42}
          fontFamily="IBM Plex Mono, monospace"
          fontSize={10}
          fill={c.text}
          opacity={0.7}
        >
          {box.subtitle}
        </text>
      )}
      {box.subtitle2 && (
        <text
          x={box.x + 10}
          y={box.y + 56}
          fontFamily="IBM Plex Mono, monospace"
          fontSize={9}
          fill={c.text}
          opacity={0.55}
        >
          {box.subtitle2}
        </text>
      )}
    </g>
  );
}

function TopologyConnector({ from, to, dashed, kind }) {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const midX = (x1 + x2) / 2;
  const path = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;

  // stretched-peer: blue (part of a stretched pair)
  // additional-site: purple (instance manages this remote site but doesn't
  // stretch across it — e.g. a local WLD living at a 3rd region)
  const color = !dashed ? "#94a3b8" : kind === "additional-site" ? "#a855f7" : "#2563eb";

  return (
    <path
      d={path}
      stroke={color}
      strokeWidth={dashed ? 1.8 : 1.2}
      strokeDasharray={dashed ? "6 3" : "none"}
      fill="none"
    />
  );
}

function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n - 1) + "…" : s || "";
}

// Topology layout — v5 model. Sites and instances are sibling top-level
// arrays; an instance can reference 1 or 2 sites. The visual is left-to-right
// in four columns:
//
//   col 0: Sites          (each at the y-midpoint of its referencing instances)
//   col 1: Instances      (each at the y-midpoint of its domains)
//   col 2: Domains        (each at the y-midpoint of its clusters)
//   col 3: Clusters       (leaves — each on its own row)
//
// Connectors:
//   solid grey  : domain→cluster, instance→domain, and site→instance for siteIds[0]
//   dashed blue : second site→instance for siteIds[1] (the stretched edge)
//
// Witness boxes are collected during the main loop into a separate array and
// appended after iteration completes — never mutate `boxes` while a forEach
// is walking it.
function computeTopologyLayout(fleet, fleetResult) {
  const COL_WIDTH = 240;
  const COL_GAP = 60;
  const BOX_HEIGHT = 78;
  const ROW_GAP = 14;
  const PADDING = 30;

  const SITE_COL = 0;
  const INST_COL = 1;
  const DOM_COL  = 2;
  const CLU_COL  = 3;
  const colX = (col) => PADDING + col * (COL_WIDTH + COL_GAP);

  const boxes = [];
  const connectors = [];
  const stretchedConnectors = [];
  const witnessBoxes = [];

  // Step 1: stub site boxes in col 0. Their y is filled in once instances
  // have been laid out (a site sits at the midpoint of its referencing
  // instances). Sites with no referencing instances (orphans) get appended
  // at the bottom in step 3.
  const siteBoxes = {};
  fleet.sites.forEach((site) => {
    const box = {
      id: site.id,
      x: colX(SITE_COL),
      y: 0,
      width: COL_WIDTH,
      height: BOX_HEIGHT,
      kind: "site",
      label: site.name,
      subtitle: site.location || "",
      subtitle2: null,
    };
    siteBoxes[site.id] = box;
    boxes.push(box);
  });

  // Step 2: lay out instances, their domains, and their clusters. Cluster
  // rows drive a global currentRow counter; domains and instances are
  // y-centered over their children.
  let currentRow = 0;
  const instanceBoxes = [];

  fleet.instances.forEach((inst, iIdx) => {
    const ir = fleetResult.instanceResults[iIdx];
    if (!ir) return;
    const hasAnyStretchedDomain = inst.domains.some(
      (d) => d.placement === "stretched"
        && Array.isArray(d.stretchSiteIds)
        && d.stretchSiteIds.length === 2
    );
    const touchesMultipleSites = (inst.siteIds || []).length >= 2;
    const profileLabel = DEPLOYMENT_PROFILES[inst.deploymentProfile]?.label || "Custom";

    const domBoxes = [];
    inst.domains.forEach((dom, dIdx) => {
      const dr = ir.domainResults[dIdx];
      if (!dr) return;
      const cluBoxes = [];
      dom.clusters.forEach((clu, cIdx) => {
        const cr = dr.clusterResults[cIdx];
        if (!cr) return;
        const y = PADDING + currentRow * (BOX_HEIGHT + ROW_GAP);
        currentRow++;
        const cluBox = {
          id: clu.id,
          x: colX(CLU_COL),
          y,
          width: COL_WIDTH,
          height: BOX_HEIGHT,
          kind: "cluster",
          label: clu.name,
          subtitle: `${cr.finalHosts} hosts · ${fmt(cr.licensedCores)} cores`,
          subtitle2: `Limit: ${cr.limiter}`,
        };
        boxes.push(cluBox);
        cluBoxes.push(cluBox);
      });
      // Domain box vertically centered over its clusters; if no clusters,
      // give it its own row so it doesn't collapse to y=0.
      let domY;
      if (cluBoxes.length > 0) {
        const minY = cluBoxes[0].y;
        const maxY = cluBoxes[cluBoxes.length - 1].y + BOX_HEIGHT;
        domY = (minY + maxY) / 2 - BOX_HEIGHT / 2;
      } else {
        domY = PADDING + currentRow * (BOX_HEIGHT + ROW_GAP);
        currentRow++;
      }
      const isStretchedDom =
        dom.placement === "stretched"
        && Array.isArray(dom.stretchSiteIds)
        && dom.stretchSiteIds.length === 2;
      const stretchedTag = isStretchedDom ? "↔ Stretched · " : "";
      const importedTag = dom.imported ? "⌂ Brownfield · " : "";
      const domBox = {
        id: dom.id,
        x: colX(DOM_COL),
        y: domY,
        width: COL_WIDTH,
        height: BOX_HEIGHT,
        kind: dom.type === "mgmt" ? "mgmt" : "workload",
        label: dom.imported ? `⌂ ${dom.name}` : dom.name,
        subtitle: `${dr.totalHosts} hosts · ${fmt(dr.totalCores)} cores`,
        subtitle2: `${importedTag}${stretchedTag}${dom.clusters.length} cluster${dom.clusters.length === 1 ? "" : "s"}`,
      };
      boxes.push(domBox);
      cluBoxes.forEach((cb) => connectors.push({ from: domBox, to: cb }));
      domBoxes.push(domBox);
    });

    // Instance box vertically centered over its domains.
    let instY;
    if (domBoxes.length > 0) {
      const minY = domBoxes[0].y;
      const maxY = domBoxes[domBoxes.length - 1].y + BOX_HEIGHT;
      instY = (minY + maxY) / 2 - BOX_HEIGHT / 2;
    } else {
      instY = PADDING + currentRow * (BOX_HEIGHT + ROW_GAP);
      currentRow++;
    }
    const instBox = {
      id: inst.id,
      x: colX(INST_COL),
      y: instY,
      width: COL_WIDTH,
      height: BOX_HEIGHT,
      kind: "instance",
      label: inst.name,
      subtitle: `${ir.totalHosts} hosts · ${fmt(ir.totalCores)} cores`,
      subtitle2: `${profileLabel}${hasAnyStretchedDomain ? " · ↔ Stretched" : touchesMultipleSites ? " · multi-site" : ""} · ${inst.domains.length} dom`,
    };
    boxes.push(instBox);
    domBoxes.forEach((db) => connectors.push({ from: instBox, to: db }));
    instanceBoxes.push({ instBox, inst });

    // Witness box collected separately — appended after the main loop.
    if (hasAnyStretchedDomain && inst.witnessEnabled !== false && inst.witnessSite?.name) {
      witnessBoxes.push({
        id: `witness-${inst.id}`,
        x: colX(INST_COL),
        y: instY + BOX_HEIGHT + 6,
        width: COL_WIDTH,
        height: 28,
        kind: "witness",
        label: `⬦ Witness: ${inst.witnessSite.name}`,
        subtitle: null,
        subtitle2: null,
      });
    }
  });

  // Step 3: position site boxes at the y-midpoint of their referencing
  // instance boxes. Orphan sites (no referencing instances) append at the
  // bottom on their own rows.
  fleet.sites.forEach((site) => {
    const refs = instanceBoxes.filter(({ inst }) => (inst.siteIds || []).includes(site.id));
    const sBox = siteBoxes[site.id];
    if (refs.length === 0) {
      sBox.y = PADDING + currentRow * (BOX_HEIGHT + ROW_GAP);
      currentRow++;
    } else {
      const minY = Math.min(...refs.map((r) => r.instBox.y));
      const maxY = Math.max(...refs.map((r) => r.instBox.y + BOX_HEIGHT));
      sBox.y = (minY + maxY) / 2 - BOX_HEIGHT / 2;
    }
    const refCount = refs.length;
    sBox.subtitle2 = `${refCount} instance${refCount === 1 ? "" : "s"}`;
  });

  // Step 4: build site→instance connectors. The first site is the instance's
  // primary anchor (solid). Any remaining sites that participate in a
  // stretched pair on this instance become dashed-blue peer connectors; the
  // rest (additional sites that host only local domains) become dashed
  // connectors too. Skip silently if a referenced site no longer exists.
  instanceBoxes.forEach(({ instBox, inst }) => {
    const ids = inst.siteIds || [];
    if (ids.length === 0) return;
    const stretchedSitesForInstance = new Set();
    for (const d of inst.domains || []) {
      const pair = Array.isArray(d.stretchSiteIds) ? d.stretchSiteIds : null;
      if (d.placement === "stretched" && pair && pair.length === 2) {
        pair.forEach((sid) => stretchedSitesForInstance.add(sid));
      }
    }
    if (ids[0] && siteBoxes[ids[0]]) {
      connectors.push({ from: siteBoxes[ids[0]], to: instBox });
    }
    for (let k = 1; k < ids.length; k++) {
      const sid = ids[k];
      if (sid && siteBoxes[sid]) {
        stretchedConnectors.push({
          from: siteBoxes[sid],
          to: instBox,
          dashed: true,
          kind: stretchedSitesForInstance.has(sid) ? "stretched-peer" : "additional-site",
        });
      }
    }
  });

  // Step 5: append witness boxes once the main iteration is complete.
  witnessBoxes.forEach((wb) => boxes.push(wb));
  if (witnessBoxes.length > 0) {
    currentRow += witnessBoxes.length * 0.5;
  }

  // Step 6: defensive — strip back-refs that earlier versions stashed onto
  // boxes. The new layout doesn't add any, but a stale `_instanceData` /
  // `_siteId` would bloat React's serialized state and confuse anyone
  // inspecting the layout.
  boxes.forEach((b) => { delete b._instanceData; delete b._siteId; });

  const totalWidth = PADDING * 2 + 4 * COL_WIDTH + 3 * COL_GAP;
  const totalHeight = Math.max(PADDING * 2 + currentRow * (BOX_HEIGHT + ROW_GAP), 200);

  return { boxes, connectors, stretchedConnectors, width: totalWidth, height: totalHeight };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
function escapeXml(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeMermaidId(s) {
  return String(s).replace(/[^a-zA-Z0-9]/g, "_");
}

// ─────────────────────────────────────────────────────────────────────────────
// PHYSICAL (SITE-CENTRIC) TOPOLOGY LAYOUT
//
// Produces a nested container layout: sites as large rectangles containing
// their domains and clusters, with appliance icons inside each cluster.
// Stretched domains appear in both site containers connected by dashed bands.
// ─────────────────────────────────────────────────────────────────────────────
const PHYS_SITE_PAD = 24;
const PHYS_DOMAIN_PAD = 16;
const PHYS_CLUSTER_PAD = 12;
const PHYS_SITE_GAP = 140;
const PHYS_DOMAIN_GAP = 14;
const PHYS_CLUSTER_GAP = 10;
const PHYS_APPLIANCE_W = 280;
const PHYS_APPLIANCE_H = 24;
const PHYS_APPLIANCE_GAP = 3;
const PHYS_APPLIANCE_COLS = 1;
const PHYS_CLUSTER_HEADER_H = 52;
const PHYS_DOMAIN_HEADER_H = 30;
const PHYS_SITE_HEADER_H = 36;
const PHYS_HOST_BADGE_H = 22;
const PHYS_CANVAS_PAD = 30;

function computePhysicalLayout(fleet, fleetResult) {

  const sites = [];
  const stretchedBands = [];
  const witnesses = [];

  // Build lookup maps
  const siteById = {};
  fleet.sites.forEach((s) => { siteById[s.id] = s; });

  // For each site, collect domains that belong to it (local domains pinned here,
  // plus stretched domains from instances touching this site).
  const siteDomains = {};
  fleet.sites.forEach((s) => { siteDomains[s.id] = []; });

  // Track stretched domain pairs to draw bands later
  const stretchedPairs = [];

  fleet.instances.forEach((inst, iIdx) => {
    const ir = fleetResult.instanceResults[iIdx];
    if (!ir) return;
    // Collect the union of site ids touched by any stretched domain on this
    // instance — used to decide where to anchor the witness box. An instance
    // can touch 3+ sites but only stretch specific pairs; the witness only
    // connects to sites participating in a stretched pair.
    const stretchedPairSites = new Set();
    let instanceHasStretchedDomain = false;

    inst.domains.forEach((dom, dIdx) => {
      const dr = ir.domainResults[dIdx];
      if (!dr) return;
      const pair = Array.isArray(dom.stretchSiteIds) ? dom.stretchSiteIds : null;
      const isStretchedDomain =
        dom.placement === "stretched" && pair && pair.length === 2;

      if (isStretchedDomain) {
        instanceHasStretchedDomain = true;
        pair.forEach((sId) => stretchedPairSites.add(sId));
        // Stretched domain appears in both of ITS pair sites (not necessarily
        // all of inst.siteIds).
        pair.forEach((sId) => {
          if (siteDomains[sId]) {
            const pct = getHostSplitPct(dom);
            const sharePct = sId === pair[0] ? pct : 100 - pct;
            siteDomains[sId].push({ dom, dr, inst, ir, sharePct, stretched: true });
          }
        });
        stretchedPairs.push({ domId: dom.id, siteIds: pair, dom, hostSplitPct: dom.hostSplitPct });
      } else {
        // Local domain — pinned to localSiteId or falls back to siteIds[0].
        const targetSite = dom.localSiteId && inst.siteIds.includes(dom.localSiteId)
          ? dom.localSiteId : inst.siteIds[0];
        if (siteDomains[targetSite]) {
          siteDomains[targetSite].push({ dom, dr, inst, ir, sharePct: 100, stretched: false });
        }
      }
    });

    // Collect witness — only when at least one domain is actually stretched.
    if (instanceHasStretchedDomain && inst.witnessEnabled !== false && inst.witnessSite?.name && ir.witness) {
      witnesses.push({
        id: `witness-${inst.id}`,
        label: `Witness: ${inst.witnessSite.name}`,
        size: inst.witnessSize || "Medium",
        instanceName: inst.name,
        siteIds: [...stretchedPairSites],
        vcpu: ir.witness.vcpu,
        ram: ir.witness.ram,
        instances: ir.witness.instances,
      });
    }
  });

  // Order domains within each site: Mgmt domains always render first (on top)
  // regardless of which VCF instance owns them, followed by workload domains.
  // Within each kind, preserve fleet instance order, then original relative
  // order. This guarantees a Mgmt domain never appears below a WLD at any site
  // — e.g. when one instance's stretched WLD shares a site with another
  // instance's local Mgmt.
  const instOrder = new Map(fleet.instances.map((inst, i) => [inst.id, i]));
  Object.keys(siteDomains).forEach((sId) => {
    siteDomains[sId] = siteDomains[sId]
      .map((entry, idx) => ({ entry, idx }))
      .sort((a, b) => {
        const aMgmt = a.entry.dom.type === "mgmt" ? 0 : 1;
        const bMgmt = b.entry.dom.type === "mgmt" ? 0 : 1;
        if (aMgmt !== bMgmt) return aMgmt - bMgmt;
        const aI = instOrder.get(a.entry.inst.id) ?? 0;
        const bI = instOrder.get(b.entry.inst.id) ?? 0;
        if (aI !== bI) return aI - bI;
        return a.idx - b.idx;
      })
      .map((x) => x.entry);
  });

  // Lay out each site
  let siteX = PHYS_CANVAS_PAD;

  fleet.sites.forEach((site) => {
    const entries = siteDomains[site.id] || [];
    let innerY = PHYS_SITE_PAD + PHYS_SITE_HEADER_H;
    const domainLayouts = [];

    entries.forEach((entry) => {
      const { dom, dr, inst, sharePct, stretched } = entry;
      const placement = stretched ? ensurePlacement(inst) : {};
      let clusterInnerY = PHYS_DOMAIN_PAD + PHYS_DOMAIN_HEADER_H;
      const clusterLayouts = [];

      dom.clusters.forEach((clu, cIdx) => {
        const cr = dr.clusterResults[cIdx];
        if (!cr) return;

        // Collect appliances for this cluster, split by site placement
        const appliances = (clu.infraStack || []).map((item) => {
          const def = APPLIANCE_DB[item.id];
          const sz = applianceSize(def, item.size, fleet?.vcfVersion) || { vcpu: 0, ram: 0, disk: 0 };
          const totalCount = item.instances || 1;
          // For stretched domains, count only VMs assigned to this site
          let countHere = totalCount;
          if (stretched && placement[item.key]) {
            countHere = placement[item.key].filter((sid) => sid === site.id).length;
          }
          if (countHere === 0) return null;
          return {
            id: item.id,
            key: item.key,
            instId: inst.id,
            label: def?.label || item.id,
            size: item.size,
            count: countHere,
            totalCount,
            vcpu: sz.vcpu * countHere,
            ram: sz.ram * countHere,
            disk: applianceEntryDisk(item, def, sz) * countHere,
            canMove: stretched && totalCount > 1,
          };
        }).filter(Boolean);

        // Calculate cluster box height
        const applianceRows = Math.ceil(appliances.length / PHYS_APPLIANCE_COLS);
        const applianceBlockH = applianceRows > 0
          ? applianceRows * (PHYS_APPLIANCE_H + PHYS_APPLIANCE_GAP) + 4
          : 0;
        const clusterH = PHYS_CLUSTER_HEADER_H + PHYS_HOST_BADGE_H + applianceBlockH + PHYS_CLUSTER_PAD;

        // Compute host count at this site for stretched clusters
        const full = cr.finalHosts || 0;
        let hostsHere = full;
        if (stretched) {
          const pct = getHostSplitPct(dom);
          const primaryHosts = Math.ceil(full * (pct / 100));
          hostsHere = sharePct === pct ? primaryHosts : full - primaryHosts;
        }

        clusterLayouts.push({
          id: clu.id,
          name: clu.name,
          relY: clusterInnerY,
          height: clusterH,
          hostCount: hostsHere,
          totalHosts: full,
          cores: cr.licensedCores,
          rawTib: cr.rawTib,
          limiter: cr.limiter,
          failover: cr.failover,
          appliances,
        });

        clusterInnerY += clusterH + PHYS_CLUSTER_GAP;
      });

      const domainH = clusterInnerY + PHYS_DOMAIN_PAD - PHYS_CLUSTER_GAP;

      domainLayouts.push({
        id: dom.id,
        name: dom.name,
        type: dom.type,
        imported: !!dom.imported,
        placement: stretched ? "stretched" : "local",
        sharePct,
        relY: innerY,
        height: domainH,
        clusters: clusterLayouts,
      });

      innerY += domainH + PHYS_DOMAIN_GAP;
    });

    const siteH = innerY + PHYS_SITE_PAD - PHYS_DOMAIN_GAP;

    // Compute widths: cluster content width drives everything
    const clusterContentW = PHYS_CLUSTER_PAD * 2 + PHYS_APPLIANCE_COLS * (PHYS_APPLIANCE_W + PHYS_APPLIANCE_GAP);
    const domainW = PHYS_DOMAIN_PAD * 2 + clusterContentW;
    const siteW = PHYS_SITE_PAD * 2 + domainW;

    // Position clusters and domains absolutely
    const domainsFinal = domainLayouts.map((dl) => ({
      ...dl,
      x: siteX + PHYS_SITE_PAD,
      y: dl.relY,
      width: domainW,
      clusters: dl.clusters.map((cl) => ({
        ...cl,
        x: siteX + PHYS_SITE_PAD + PHYS_DOMAIN_PAD,
        y: dl.relY + cl.relY,
        width: clusterContentW,
      })),
    }));

    sites.push({
      id: site.id,
      name: site.name,
      location: site.location || "",
      x: siteX,
      y: PHYS_CANVAS_PAD,
      width: siteW,
      height: Math.max(siteH, 120),
      domains: domainsFinal,
    });

    siteX += siteW + PHYS_SITE_GAP;
  });

  // Normalize: all sites same height, and matched stretched domains/clusters
  // share the same height so the layout is balanced across sites.
  if (sites.length > 1) {
    // Equalize matched domain heights across sites
    const domIds = new Set();
    sites.forEach((s) => s.domains.forEach((d) => domIds.add(d.id)));
    for (const did of domIds) {
      const matches = sites.flatMap((s) => s.domains.filter((d) => d.id === did));
      if (matches.length > 1) {
        // Equalize matched cluster heights first
        const maxClusters = Math.max(...matches.map((d) => d.clusters.length));
        for (let ci = 0; ci < maxClusters; ci++) {
          const cluMatches = matches.map((d) => d.clusters[ci]).filter(Boolean);
          if (cluMatches.length > 1) {
            const maxCH = Math.max(...cluMatches.map((c) => c.height));
            cluMatches.forEach((c) => { c.height = maxCH; });
          }
        }
        // Recalc domain height from equalized clusters
        matches.forEach((d) => {
          let cy = PHYS_DOMAIN_PAD + PHYS_DOMAIN_HEADER_H;
          d.clusters.forEach((c) => { c.relY = cy; cy += c.height + PHYS_CLUSTER_GAP; });
          d.height = cy + PHYS_DOMAIN_PAD - PHYS_CLUSTER_GAP;
        });
        const maxDH = Math.max(...matches.map((d) => d.height));
        matches.forEach((d) => { d.height = maxDH; });
      }
    }

    // Re-flow domain y positions within each site after height equalization
    sites.forEach((s) => {
      let dy = PHYS_SITE_PAD + PHYS_SITE_HEADER_H;
      s.domains.forEach((d) => {
        d.y = dy;
        // Update absolute cluster positions
        d.clusters.forEach((c) => {
          c.y = dy + c.relY;
        });
        dy += d.height + PHYS_DOMAIN_GAP;
      });
      s.height = Math.max(dy + PHYS_SITE_PAD - PHYS_DOMAIN_GAP, 120);
    });

    // Equalize site heights
    const maxH = Math.max(...sites.map((s) => s.height));
    sites.forEach((s) => { s.height = maxH; });
  }

  // Build stretched bands connecting matching domains across sites
  stretchedPairs.forEach((pair) => {
    const s0 = sites.find((s) => s.id === pair.siteIds[0]);
    const s1 = sites.find((s) => s.id === pair.siteIds[1]);
    if (!s0 || !s1) return;
    const d0 = s0.domains.find((d) => d.id === pair.domId);
    const d1 = s1.domains.find((d) => d.id === pair.domId);
    if (!d0 || !d1) return;
    const pct = getHostSplitPct(pair);
    stretchedBands.push({
      domainId: pair.domId,
      label: `Stretched ${pct}/${100 - pct}`,
      from: { x: s0.x + s0.width, y: PHYS_CANVAS_PAD + d0.y + d0.height / 2 },
      to: { x: s1.x, y: PHYS_CANVAS_PAD + d1.y + d1.height / 2 },
    });
  });

  // Position witnesses below the sites
  const maxSiteBottom = Math.max(...sites.map((s) => s.y + s.height), 200);
  witnesses.forEach((w, i) => {
    w.x = PHYS_CANVAS_PAD + i * 280;
    w.y = maxSiteBottom + 30;
    w.width = 260;
    w.height = 50;
  });

  const totalWidth = Math.max(
    siteX - PHYS_SITE_GAP + PHYS_CANVAS_PAD,
    witnesses.length * 280 + PHYS_CANVAS_PAD * 2,
    400
  );
  const witnessBottom = witnesses.length > 0 ? witnesses[0].y + witnesses[0].height + PHYS_CANVAS_PAD : 0;
  const totalHeight = Math.max(maxSiteBottom + PHYS_CANVAS_PAD, witnessBottom, 200);

  return { sites, stretchedBands, witnesses, width: totalWidth, height: totalHeight };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHYSICAL TOPOLOGY SVG COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function PhysicalTopologyView({ fleet, fleetResult, setFleet }) {
  const layout = useMemo(() => {
    try {
      return computePhysicalLayout(fleet, fleetResult);
    } catch (err) {
      // Physical layout error silenced for production
      return { sites: [], stretchedBands: [], witnesses: [], width: 400, height: 100, _error: err.message };
    }
  }, [fleet, fleetResult]);

  // Move one VM of an appliance from the current site to "the other site" of
  // the appliance's owning domain pair. For a stretched domain A↔B, an
  // appliance VM at A moves to B (and vice versa) regardless of how many
  // other sites the instance touches. Local-domain appliances are not
  // movable and this should never fire for them (upstream canMove gate).
  const moveAppliance = (instId, appKey, fromSiteId) => {
    setFleet((prev) => ({
      ...prev,
      instances: prev.instances.map((inst) => {
        if (inst.id !== instId) return inst;
        if ((inst.siteIds || []).length < 2) return inst;
        // Locate the owning domain by finding the entry with matching key.
        let owningPair = null;
        for (const dom of inst.domains || []) {
          const matches =
            (dom.clusters || []).some((c) => (c.infraStack || []).some((e) => e.key === appKey))
            || (dom.wldStack || []).some((e) => e.key === appKey);
          if (matches) {
            if (dom.placement === "stretched"
                && Array.isArray(dom.stretchSiteIds)
                && dom.stretchSiteIds.length === 2) {
              owningPair = dom.stretchSiteIds;
            }
            break;
          }
        }
        // Fall back to the instance's first 2 siteIds if we can't resolve
        // the owning domain's pair (legacy 2-site data path).
        const pair = owningPair || [inst.siteIds[0], inst.siteIds[1]];
        if (!pair.includes(fromSiteId)) return inst;
        const otherSite = pair.find((s) => s !== fromSiteId);
        if (!otherSite) return inst;
        const placement = ensurePlacement(inst);
        const arr = [...(placement[appKey] || [])];
        const idx = arr.indexOf(fromSiteId);
        if (idx === -1) return inst;
        arr[idx] = otherSite;
        return { ...inst, appliancePlacement: { ...placement, [appKey]: arr } };
      }),
    }));
  };

  if (layout._error) {
    return (
      <div className="border border-rose-300 bg-rose-50 rounded-lg p-5">
        <h2 className="font-serif text-xl text-rose-900 mb-2">Physical layout error</h2>
        <p className="text-sm text-rose-700 font-mono">{layout._error}</p>
      </div>
    );
  }

  const verdictColor = (v) => v === "green" ? "#16a34a" : v === "yellow" ? "#ca8a04" : "#dc2626";

  return (
    <div className="overflow-auto bg-slate-50 rounded border border-slate-200 p-4">
      <svg width={layout.width} height={layout.height} xmlns="http://www.w3.org/2000/svg"
        style={{ minWidth: "100%" }}>

        {/* Stretched bands */}
        {layout.stretchedBands.map((band, i) => {
          const midX = (band.from.x + band.to.x) / 2;
          return (
            <g key={`band-${i}`}>
              <path
                d={`M ${band.from.x} ${band.from.y} L ${band.to.x} ${band.to.y}`}
                stroke="#2563eb" strokeWidth={2} strokeDasharray="8 4" fill="none"
              />
              <rect x={midX - 50} y={Math.min(band.from.y, band.to.y) - 14}
                width={100} height={18} rx={9} fill="#eff6ff" stroke="#2563eb" strokeWidth={0.8} />
              <text x={midX} y={Math.min(band.from.y, band.to.y) - 2}
                textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize={8}
                fill="#2563eb" fontWeight="500">{band.label}</text>
            </g>
          );
        })}

        {/* Site containers */}
        {layout.sites.map((site) => (
          <g key={site.id}>
            {/* Site box */}
            <rect x={site.x} y={site.y} width={site.width} height={site.height}
              rx={8} fill={TOPOLOGY_COLORS.site.fill} stroke={TOPOLOGY_COLORS.site.stroke}
              strokeWidth={2} />
            {/* Site header */}
            <text x={site.x + 14} y={site.y + 22}
              fontFamily="Inter, system-ui, sans-serif" fontSize={15} fontWeight="700"
              fill={TOPOLOGY_COLORS.site.text}>{truncate(site.name, 28)}</text>
            <text x={site.x + site.width - 14} y={site.y + 22}
              textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize={9}
              fill={TOPOLOGY_COLORS.site.text} opacity={0.6}>{site.location}</text>

            {/* Domains within site */}
            {site.domains.map((dom) => {
              const dc = TOPOLOGY_COLORS[dom.type === "mgmt" ? "mgmt" : "workload"];
              return (
                <g key={`${site.id}-${dom.id}`}>
                  {/* Domain container */}
                  <rect x={dom.x} y={site.y + dom.y} width={dom.width} height={dom.height}
                    rx={6} fill={dc.fill} stroke={dc.stroke} strokeWidth={1.2} />
                  {/* Domain header */}
                  <text x={dom.x + 10} y={site.y + dom.y + 18}
                    fontFamily="Inter, system-ui, sans-serif" fontSize={11} fontWeight="600"
                    fill={dc.text}>
                    {dom.imported ? "⌂ " : ""}{truncate(dom.name, dom.imported ? 30 : 32)}
                  </text>
                  {dom.placement === "stretched" && (
                    <text x={dom.x + dom.width - 10} y={site.y + dom.y + 18}
                      textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize={8}
                      fill="#2563eb" fontWeight="500">↔ {dom.sharePct}%</text>
                  )}

                  {/* Clusters within domain */}
                  {dom.clusters.map((clu) => {
                    const cc = TOPOLOGY_COLORS.cluster;
                    return (
                      <g key={`${site.id}-${dom.id}-${clu.id}`}>
                        <rect x={clu.x} y={site.y + clu.y} width={clu.width} height={clu.height}
                          rx={4} fill={cc.fill} stroke={cc.stroke} strokeWidth={1} />
                        {/* Cluster header */}
                        <text x={clu.x + 8} y={site.y + clu.y + 16}
                          fontFamily="Inter, system-ui, sans-serif" fontSize={11} fontWeight="600"
                          fill={cc.text}>{truncate(clu.name, 26)}</text>
                        <text x={clu.x + 8} y={site.y + clu.y + 30}
                          fontFamily="IBM Plex Mono, monospace" fontSize={9}
                          fill={cc.text} opacity={0.7}>
                          Limit: {clu.limiter}
                        </text>
                        {/* Failover badge */}
                        {clu.failover && (
                          <g>
                            <circle cx={clu.x + clu.width - 20} cy={site.y + clu.y + 16}
                              r={5} fill={verdictColor(clu.failover.siteA.verdict)} />
                            <circle cx={clu.x + clu.width - 8} cy={site.y + clu.y + 16}
                              r={5} fill={verdictColor(clu.failover.siteB.verdict)} />
                          </g>
                        )}
                        {/* Host badge */}
                        <rect x={clu.x + 6} y={site.y + clu.y + PHYS_CLUSTER_HEADER_H - 8}
                          width={clu.width - 12} height={PHYS_HOST_BADGE_H} rx={3}
                          fill="white" stroke={cc.stroke} strokeWidth={0.6} opacity={0.9} />
                        <text x={clu.x + 14} y={site.y + clu.y + PHYS_CLUSTER_HEADER_H + 8}
                          fontFamily="IBM Plex Mono, monospace" fontSize={10}
                          fill={cc.text} fontWeight="600">
                          {clu.hostCount} hosts · {fmt(clu.cores)} cores · {(clu.rawTib || 0).toFixed(1)} TiB
                        </text>
                        {/* Appliance pills — single column, full name + resources */}
                        {clu.appliances.map((app, ai) => {
                          const ax = clu.x + PHYS_CLUSTER_PAD;
                          const pillW = clu.width - PHYS_CLUSTER_PAD * 2;
                          const ay = site.y + clu.y + PHYS_CLUSTER_HEADER_H + PHYS_HOST_BADGE_H + 4 +
                            ai * (PHYS_APPLIANCE_H + PHYS_APPLIANCE_GAP);
                          const ac = TOPOLOGY_COLORS.appliance;
                          const movable = app.canMove && setFleet;
                          const resText = `${app.vcpu}cpu ${app.ram}GB`;
                          return (
                            <g key={`app-${clu.id}-${ai}`}
                              style={movable ? { cursor: "pointer" } : undefined}
                              onClick={movable ? () => moveAppliance(app.instId, app.key, site.id) : undefined}>
                              <rect x={ax} y={ay} width={pillW} height={PHYS_APPLIANCE_H}
                                rx={3} fill={ac.fill} stroke={movable ? "#2563eb" : ac.stroke}
                                strokeWidth={movable ? 1 : 0.8} />
                              <text x={ax + 6} y={ay + 16}
                                fontFamily="Inter, system-ui, sans-serif" fontSize={10} fontWeight="500"
                                fill={ac.text}>{truncate(app.label, 26)}{app.count > 1 ? ` ×${app.count}` : ""}</text>
                              <text x={ax + pillW - (movable ? 20 : 6)} y={ay + 16}
                                textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize={9}
                                fill={ac.text} opacity={0.55}>{resText}</text>
                              {movable && (
                                <text x={ax + pillW - 6} y={ay + 16}
                                  fontFamily="IBM Plex Mono, monospace" fontSize={10}
                                  fill="#2563eb" textAnchor="end">→</text>
                              )}
                            </g>
                          );
                        })}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>
        ))}

        {/* Witness boxes */}
        {layout.witnesses.map((w) => {
          const wc = TOPOLOGY_COLORS.witness;
          return (
            <g key={w.id}>
              <rect x={w.x} y={w.y} width={w.width} height={w.height}
                rx={4} fill={wc.fill} stroke={wc.stroke} strokeWidth={1.2}
                strokeDasharray="4 2" />
              <text x={w.x + 10} y={w.y + 20}
                fontFamily="Inter, system-ui, sans-serif" fontSize={11} fontWeight="600"
                fill={wc.text}>⬦ {w.label}</text>
              <text x={w.x + 10} y={w.y + 36}
                fontFamily="IBM Plex Mono, monospace" fontSize={9}
                fill={wc.text} opacity={0.7}>
                {w.size} · {w.instances} cluster{w.instances === 1 ? "" : "s"} · {w.instanceName}
              </text>
              {/* Connectors to sites */}
              {w.siteIds.map((sId, si) => {
                const s = layout.sites.find((ls) => ls.id === sId);
                if (!s) return null;
                const sx = s.x + s.width / 2;
                const sy = s.y + s.height;
                const wx = w.x + w.width / 2;
                const wy = w.y;
                return (
                  <path key={`wc-${si}`}
                    d={`M ${wx} ${wy} L ${wx} ${(wy + sy) / 2} L ${sx} ${(wy + sy) / 2} L ${sx} ${sy}`}
                    stroke={wc.stroke} strokeWidth={1} strokeDasharray="4 2" fill="none" />
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAW.IO XML EXPORT
// ─────────────────────────────────────────────────────────────────────────────
function generateDrawioXml(layoutData, layoutType) {
  let nextId = 2;
  const id = () => nextId++;
  const cells = [];

  const styleStr = (opts) => Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(";") + ";";

  if (layoutType === "logical") {
    // Logical layout: flat boxes and connectors
    const idMap = {};
    for (const box of layoutData.boxes) {
      const cellId = id();
      idMap[box.id] = cellId;
      const tc = TOPOLOGY_COLORS[box.kind] || TOPOLOGY_COLORS.cluster;
      const label = [
        `<b>${escapeXml(box.label)}</b>`,
        box.subtitle ? `<br/><font style="font-size:10px">${escapeXml(box.subtitle)}</font>` : "",
        box.subtitle2 ? `<br/><font style="font-size:9px;opacity:0.6">${escapeXml(box.subtitle2)}</font>` : "",
      ].join("");
      const style = styleStr({
        rounded: 1, whiteSpace: "wrap", html: 1,
        fillColor: tc.fill, strokeColor: tc.stroke, fontColor: tc.text,
        strokeWidth: box.kind === "witness" ? 1 : 1.5, arcSize: 8,
        ...(box.kind === "witness" ? { dashed: 1, dashPattern: "4 2" } : {}),
      });
      cells.push(`    <mxCell id="${cellId}" value="${escapeXml(label)}" style="${style}" vertex="1" parent="1">
      <mxGeometry x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" as="geometry"/>
    </mxCell>`);
    }
    for (const conn of layoutData.connectors) {
      const src = idMap[conn.from.id];
      const tgt = idMap[conn.to.id];
      if (!src || !tgt) continue;
      const style = styleStr({
        edgeStyle: "orthogonalEdgeStyle", strokeColor: "#94a3b8", strokeWidth: 1.2,
      });
      cells.push(`    <mxCell id="${id()}" style="${style}" edge="1" source="${src}" target="${tgt}" parent="1">
      <mxGeometry relative="1" as="geometry"/>
    </mxCell>`);
    }
    for (const conn of (layoutData.stretchedConnectors || [])) {
      const src = idMap[conn.from.id];
      const tgt = idMap[conn.to.id];
      if (!src || !tgt) continue;
      const style = styleStr({
        edgeStyle: "orthogonalEdgeStyle", strokeColor: "#2563eb", strokeWidth: 2,
        dashed: 1, dashPattern: "6 3",
      });
      cells.push(`    <mxCell id="${id()}" style="${style}" edge="1" source="${src}" target="${tgt}" parent="1">
      <mxGeometry relative="1" as="geometry"/>
    </mxCell>`);
    }
  } else {
    // Physical layout: nested containers
    const idMap = {};
    for (const site of layoutData.sites) {
      const siteId = id();
      idMap[site.id] = siteId;
      const sc = TOPOLOGY_COLORS.site;
      const style = styleStr({
        rounded: 1, whiteSpace: "wrap", html: 1, container: 1,
        fillColor: sc.fill, strokeColor: sc.stroke, fontColor: sc.text,
        strokeWidth: 2, arcSize: 4, verticalAlign: "top", fontStyle: 1, fontSize: 14,
      });
      cells.push(`    <mxCell id="${siteId}" value="${escapeXml(site.name + (site.location ? ' — ' + site.location : ''))}" style="${style}" vertex="1" parent="1">
      <mxGeometry x="${site.x}" y="${site.y}" width="${site.width}" height="${site.height}" as="geometry"/>
    </mxCell>`);

      for (const dom of site.domains) {
        const domCellId = id();
        const dc = TOPOLOGY_COLORS[dom.type === "mgmt" ? "mgmt" : "workload"];
        const domLabel = dom.name + (dom.placement === "stretched" ? ` (${dom.sharePct}%)` : "");
        const dStyle = styleStr({
          rounded: 1, whiteSpace: "wrap", html: 1, container: 1,
          fillColor: dc.fill, strokeColor: dc.stroke, fontColor: dc.text,
          strokeWidth: 1.2, arcSize: 4, verticalAlign: "top", fontSize: 11,
        });
        cells.push(`    <mxCell id="${domCellId}" value="${escapeXml(domLabel)}" style="${dStyle}" vertex="1" parent="${siteId}">
      <mxGeometry x="${dom.x - site.x}" y="${dom.y}" width="${dom.width}" height="${dom.height}" as="geometry"/>
    </mxCell>`);

        for (const clu of dom.clusters) {
          const cluCellId = id();
          const cc = TOPOLOGY_COLORS.cluster;
          const cluLabel = `<b>${escapeXml(clu.name)}</b><br/><font style="font-size:10px">${clu.hostCount} hosts · ${fmt(clu.cores)} cores · ${(clu.rawTib || 0).toFixed(1)} TiB</font><br/><font style="font-size:9px">Limit: ${escapeXml(clu.limiter)}</font>`;
          const cStyle = styleStr({
            rounded: 1, whiteSpace: "wrap", html: 1, container: 1,
            fillColor: cc.fill, strokeColor: cc.stroke, fontColor: cc.text,
            strokeWidth: 1, arcSize: 4, verticalAlign: "top", fontSize: 11,
          });
          cells.push(`    <mxCell id="${cluCellId}" value="${escapeXml(cluLabel)}" style="${cStyle}" vertex="1" parent="${domCellId}">
      <mxGeometry x="${clu.x - dom.x}" y="${clu.y - dom.y}" width="${clu.width}" height="${clu.height}" as="geometry"/>
    </mxCell>`);

          for (const app of clu.appliances) {
            const appId = id();
            const ac = TOPOLOGY_COLORS.appliance;
            const appLabel = app.label + (app.count > 1 ? ` ×${app.count}` : "");
            const aStyle = styleStr({
              rounded: 1, whiteSpace: "wrap", html: 1,
              fillColor: ac.fill, strokeColor: ac.stroke, fontColor: ac.text,
              strokeWidth: 0.8, fontSize: 8,
            });
            const ai = clu.appliances.indexOf(app);
            const col = ai % 2;
            const row = Math.floor(ai / 2);
            const ax = 12 + col * 134;
            const ay = 60 + row * 26;
            cells.push(`    <mxCell id="${appId}" value="${escapeXml(appLabel)}" style="${aStyle}" vertex="1" parent="${cluCellId}">
      <mxGeometry x="${ax}" y="${ay}" width="130" height="22" as="geometry"/>
    </mxCell>`);
          }
        }
      }
    }

    // Stretched bands as edges between sites
    for (const band of layoutData.stretchedBands) {
      const style = styleStr({
        edgeStyle: "orthogonalEdgeStyle", strokeColor: "#2563eb", strokeWidth: 2,
        dashed: 1, dashPattern: "8 4",
      });
      // Find the two site cells
      const siteIds = layoutData.sites.filter((s) =>
        s.domains.some((d) => d.id === band.domainId)
      ).map((s) => idMap[s.id]).filter(Boolean);
      if (siteIds.length === 2) {
        cells.push(`    <mxCell id="${id()}" value="${escapeXml(band.label)}" style="${style}" edge="1" source="${siteIds[0]}" target="${siteIds[1]}" parent="1">
      <mxGeometry relative="1" as="geometry"/>
    </mxCell>`);
      }
    }

    // Witness boxes
    for (const w of layoutData.witnesses) {
      const wId = id();
      const wc = TOPOLOGY_COLORS.witness;
      const wStyle = styleStr({
        rounded: 1, whiteSpace: "wrap", html: 1,
        fillColor: wc.fill, strokeColor: wc.stroke, fontColor: wc.text,
        strokeWidth: 1.2, dashed: 1, dashPattern: "4 2", fontSize: 10,
      });
      cells.push(`    <mxCell id="${wId}" value="${escapeXml('⬦ ' + w.label)}" style="${wStyle}" vertex="1" parent="1">
      <mxGeometry x="${w.x}" y="${w.y}" width="${w.width}" height="${w.height}" as="geometry"/>
    </mxCell>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
${cells.join("\n")}
  </root>
</mxGraphModel>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MERMAID EXPORT
// ─────────────────────────────────────────────────────────────────────────────
function generateMermaidCode(layoutData, layoutType) {
  const lines = [];
  const san = sanitizeMermaidId;

  if (layoutType === "logical") {
    lines.push("flowchart LR");
    const shapes = { site: "[[", instance: "[", mgmt: "(", workload: "(", cluster: "[", witness: ">" };
    const closes = { site: "]]", instance: "]", mgmt: ")", workload: ")", cluster: "]", witness: "]" };

    for (const box of layoutData.boxes) {
      const nid = san(box.id);
      const open = shapes[box.kind] || "[";
      const close = closes[box.kind] || "]";
      const parts = [box.label];
      if (box.subtitle) parts.push(box.subtitle);
      if (box.subtitle2) parts.push(box.subtitle2);
      const label = `"${parts.join("\\n")}"`;
      lines.push(`    ${nid}${open}${label}${close}`);
    }
    lines.push("");
    for (const conn of layoutData.connectors) {
      lines.push(`    ${san(conn.from.id)} --> ${san(conn.to.id)}`);
    }
    for (const conn of (layoutData.stretchedConnectors || [])) {
      lines.push(`    ${san(conn.from.id)} -.-> ${san(conn.to.id)}`);
    }
  } else {
    lines.push("flowchart TB");

    for (const site of layoutData.sites) {
      lines.push(`    subgraph ${san(site.id)}["${site.name} — ${site.location}"]`);
      for (const dom of site.domains) {
        const domId = san(site.id + "_" + dom.id);
        lines.push(`        subgraph ${domId}["${dom.name}${dom.placement === 'stretched' ? ' ↔ ' + dom.sharePct + '%' : ''}"]`);
        for (const clu of dom.clusters) {
          const cluId = san(site.id + "_" + dom.id + "_" + clu.id);
          const appList = clu.appliances.map((a) => a.label + (a.count > 1 ? ` ×${a.count}` : "")).join(", ");
          const label = `${clu.name}\\n${clu.hostCount} hosts · ${fmt(clu.cores)} cores\\n${appList ? appList : ""}`;
          lines.push(`            ${cluId}["${label}"]`);
        }
        lines.push("        end");
      }
      lines.push("    end");
    }

    // Stretched connections between matching domain subgraphs
    for (const band of layoutData.stretchedBands) {
      const sites = layoutData.sites.filter((s) => s.domains.some((d) => d.id === band.domainId));
      if (sites.length === 2) {
        const d0 = san(sites[0].id + "_" + band.domainId);
        const d1 = san(sites[1].id + "_" + band.domainId);
        lines.push(`    ${d0} -. "${band.label}" .-> ${d1}`);
      }
    }

    // Witnesses
    for (const w of layoutData.witnesses) {
      const wid = san(w.id);
      lines.push(`    ${wid}>"${w.label}\\n${w.size} · ${w.instances} cluster${w.instances === 1 ? '' : 's'}"]`);
      for (const sId of w.siteIds) {
        lines.push(`    ${wid} -.-> ${san(sId)}`);
      }
    }
  }

  // Color classes
  lines.push("");
  for (const [kind, col] of Object.entries(TOPOLOGY_COLORS)) {
    lines.push(`    classDef ${kind} fill:${col.fill},stroke:${col.stroke},color:${col.text}`);
  }

  if (layoutType === "logical") {
    for (const box of layoutData.boxes) {
      lines.push(`    class ${san(box.id)} ${box.kind}`);
    }
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan 8b — PRINT VIEW
//
// Multi-page document rendered for "Print / Save as PDF". Always mounted
// (so it shares the existing useMemo-cached fleetResult); hidden in screen
// mode via CSS, revealed in print mode while editor chrome is hidden.
// Uses window.print() native PDF generation — vector, text-selectable,
// sub-2s for any fleet, no external libraries.
//
// The components below read fleet + fleetResult directly using stable
// engine functions (allocateClusterIps, validateNetworkDesign, stackTotals,
// resolveHostname). When new fields are added to the editor, they should
// also be surfaced here — the existing Export JSON / Workbook CSV
// integration tests cover the engine contract; PrintView adds visible
// surface for the human-readable deliverable.
// ─────────────────────────────────────────────────────────────────────────────

// Locale-locked formatters for the PDF — clients receive consistent output
// regardless of the browser locale of the consultant generating the doc.
const PRINT_LOCALE = "en-US";
const printNum = (n, frac = 0) => {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString(PRINT_LOCALE, {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });
};
const printDate = (iso) => {
  if (!iso) {
    const d = new Date();
    return d.toLocaleDateString(PRINT_LOCALE, { year: "numeric", month: "long", day: "numeric" });
  }
  // Parse YYYY-MM-DD safely (timezone-agnostic display).
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(PRINT_LOCALE, { year: "numeric", month: "long", day: "numeric" });
};

function PrintCoverPage({ fleet, fleetResult }) {
  const m = fleet.reportMetadata || {};
  const dash = (v) => (v && v.length > 0 ? v : "—");
  let mgmtDomains = 0, wldDomains = 0, totalClusters = 0;
  for (const inst of fleet.instances || []) {
    for (const dom of inst.domains || []) {
      if (dom.type === "mgmt") mgmtDomains++;
      else wldDomains++;
      totalClusters += (dom.clusters || []).length;
    }
  }
  return (
    <section className="print-page print-cover">
      <div className="print-cover-header">
        <div className="print-eyebrow">VMware Cloud Foundation {fleet.vcfVersion || DEFAULT_VCF_VERSION_LEGACY}</div>
        <h1 className="print-title">Fleet Design Document</h1>
        <div className="print-rule" />
      </div>
      <div className="print-cover-fleet">
        <div className="print-cover-fleet-name">{fleet.name || "Untitled Fleet"}</div>
      </div>
      <table className="print-cover-meta">
        <tbody>
          <tr><th>Client</th><td>{dash(m.clientName)}</td></tr>
          <tr><th>Project</th><td>{dash(m.projectId)}</td></tr>
          <tr><th>Prepared by</th><td>{dash(m.preparedBy)}</td></tr>
          <tr><th>Revision</th><td>{dash(m.revision)}</td></tr>
          <tr><th>Document date</th><td>{printDate(m.documentDate)}</td></tr>
        </tbody>
      </table>
      {/* Plan 9 — scope summary panel right under meta so the cover
          carries useful information instead of mostly white space. */}
      <div className="print-cover-scope">
        <div className="print-eyebrow print-eyebrow-sm">Scope at a glance</div>
        <div className="print-cover-scope-grid">
          <div className="print-stat">
            <div className="print-stat-value">{printNum(fleet.sites?.length || 0)}</div>
            <div className="print-stat-label">Sites</div>
          </div>
          <div className="print-stat">
            <div className="print-stat-value">{printNum(fleet.instances?.length || 0)}</div>
            <div className="print-stat-label">VCF Instances</div>
          </div>
          <div className="print-stat">
            <div className="print-stat-value">{printNum(mgmtDomains + wldDomains)}</div>
            <div className="print-stat-label">Domains <span className="print-stat-aux">({mgmtDomains}M+{wldDomains}W)</span></div>
          </div>
          <div className="print-stat">
            <div className="print-stat-value">{printNum(totalClusters)}</div>
            <div className="print-stat-label">Clusters</div>
          </div>
          <div className="print-stat">
            <div className="print-stat-value">{printNum(fleetResult.totalHosts)}</div>
            <div className="print-stat-label">Total Hosts</div>
          </div>
          <div className="print-stat">
            <div className="print-stat-value">{printNum(fleetResult.totalCores)}</div>
            <div className="print-stat-label">Licensed Cores</div>
          </div>
          <div className="print-stat">
            <div className="print-stat-value">{printNum(fleetResult.fleetRawTib, 1)}</div>
            <div className="print-stat-label">TiB Raw vSAN</div>
          </div>
          <div className="print-stat">
            <div className="print-stat-value">
              {fleetResult.addonTib > 0 ? `+${printNum(fleetResult.addonTib, 1)}` : "0"}
            </div>
            <div className="print-stat-label">TiB Add-on Required</div>
          </div>
        </div>
      </div>
      <div className="print-cover-footer">
        <div className="print-rule" />
        <div className="print-cover-stats">
          Generated with VCF Design Studio · {printDate(m.documentDate)}
        </div>
      </div>
    </section>
  );
}

function PrintTOC({ fleet }) {
  const items = [
    "Executive Summary",
    "Fleet Topology — Logical View",
    "Fleet Topology — Physical View",
  ];
  (fleet.instances || []).forEach((inst) => {
    items.push(`Instance: ${inst.name}`);
  });
  items.push("Network & Naming Configuration");
  items.push("Per-Site Capacity");
  items.push("Validation Issues");
  items.push("Fleet Appliance Inventory");
  return (
    <section className="print-page print-toc">
      <h2 className="print-h2">Contents</h2>
      <ol className="print-toc-list">
        {items.map((label, i) => (
          <li key={i}>{label}</li>
        ))}
      </ol>
    </section>
  );
}

// Plan 9 — design highlights surfaces non-obvious, decision-relevant
// design choices so a reader scanning the executive summary doesn't have
// to dig through individual sections to understand the shape of the
// design. Items shown only when they apply (no empty rows).
function PrintDesignHighlights({ fleet }) {
  const highlights = [];
  // Stretched clusters
  const stretchedDomains = [];
  for (const inst of fleet.instances || []) {
    for (const dom of inst.domains || []) {
      if (
        dom.placement === "stretched"
        && Array.isArray(dom.stretchSiteIds)
        && dom.stretchSiteIds.length === 2
      ) {
        const a = (fleet.sites || []).find((s) => s.id === dom.stretchSiteIds[0])?.name || "?";
        const b = (fleet.sites || []).find((s) => s.id === dom.stretchSiteIds[1])?.name || "?";
        stretchedDomains.push(`${dom.name} (${inst.name}) ${a} ↔ ${b}`);
      }
    }
  }
  if (stretchedDomains.length > 0) {
    highlights.push({
      label: "Stretched domains",
      detail: stretchedDomains.join(" · "),
    });
  }
  // DR pairings
  const drPairs = (fleet.instances || [])
    .filter((i) => i.drPosture === "warm-standby" && i.drPairedInstanceId)
    .map((i) => {
      const primary = (fleet.instances || []).find((p) => p.id === i.drPairedInstanceId);
      return `${primary?.name || "?"} → ${i.name} (warm-standby)`;
    });
  if (drPairs.length > 0) {
    highlights.push({ label: "DR pairings", detail: drPairs.join(" · ") });
  }
  // Brownfield (imported) workload domains
  const importedDomains = [];
  for (const inst of fleet.instances || []) {
    for (const dom of inst.domains || []) {
      if (dom.imported) importedDomains.push(`${dom.name} (${inst.name})`);
    }
  }
  if (importedDomains.length > 0) {
    highlights.push({
      label: "Brownfield (imported) workload domains",
      detail: importedDomains.join(" · "),
    });
  }
  // Per-entry placement overrides (NSX Edge or other appliances pinned to
  // workload-domain clusters via per-entry placementClusterId)
  const overrides = [];
  for (const inst of fleet.instances || []) {
    const clustersInInstance = new Set();
    for (const dom of inst.domains || []) {
      for (const c of dom.clusters || []) clustersInInstance.add(c.id);
    }
    for (const dom of inst.domains || []) {
      if (dom.type !== "workload") continue;
      const wldClusterIds = new Set((dom.clusters || []).map((c) => c.id));
      for (const e of dom.wldStack || []) {
        if (!e.placementClusterId) continue;
        if (e.placementClusterId === dom.componentsClusterId) continue;
        const def = APPLIANCE_DB[e.id];
        if (!def) continue;
        // Find target cluster name
        let targetName = e.placementClusterId;
        for (const d of inst.domains || []) {
          for (const c of d.clusters || []) {
            if (c.id === e.placementClusterId) targetName = c.name;
          }
        }
        const onWld = wldClusterIds.has(e.placementClusterId);
        overrides.push(`${def.label} → ${targetName}${onWld ? " (on this WLD's hosts)" : ""}`);
      }
    }
  }
  if (overrides.length > 0) {
    highlights.push({
      label: "Per-appliance placement overrides",
      detail: overrides.join(" · "),
    });
  }
  // Naming conventions configured?
  const nc = fleet.namingConfig || {};
  if (nc.hostTemplate || nc.vdsTemplate) {
    const parts = [];
    if (nc.hostTemplate) parts.push(`Hosts: \`${nc.hostTemplate}\``);
    if (nc.vdsTemplate) parts.push(`vDS: \`${nc.vdsTemplate}\``);
    highlights.push({ label: "Naming conventions", detail: parts.join(" · ") });
  }
  if (highlights.length === 0) return null;
  return (
    <>
      <h3 className="print-h3">Design highlights</h3>
      <table className="print-kv-table">
        <tbody>
          {highlights.map((h, i) => (
            <tr key={i}>
              <th>{h.label}</th>
              <td>{h.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function PrintExecutiveSummary({ fleet, fleetResult }) {
  const pathway = DEPLOYMENT_PATHWAYS[fleet.deploymentPathway || "greenfield"];
  const ssoMode = SSO_MODES[fleet.ssoMode || "embedded"];
  const drInstances = (fleet.instances || []).filter((i) => i.drPosture === "warm-standby").length;
  // Domain counts for the scope panel
  let mgmtDomains = 0, wldDomains = 0, totalClusters = 0;
  for (const inst of fleet.instances || []) {
    for (const dom of inst.domains || []) {
      if (dom.type === "mgmt") mgmtDomains++;
      else wldDomains++;
      totalClusters += (dom.clusters || []).length;
    }
  }
  return (
    <section className="print-page print-section">
      <h2 className="print-h2">Executive Summary</h2>
      <table className="print-kv-table">
        <tbody>
          <tr><th>Fleet name</th><td>{fleet.name || "—"}</td></tr>
          <tr><th>Deployment pathway</th><td>{pathway?.label || fleet.deploymentPathway} ({pathway?.ruleId})</td></tr>
          <tr><th>SSO model</th><td>{ssoMode?.label || fleet.ssoMode}</td></tr>
          <tr><th>NSX Federation</th><td>{fleet.federationEnabled ? "Enabled" : "Disabled"}</td></tr>
          <tr><th>Scope</th><td>
            {printNum(fleet.sites?.length || 0)} sites ·
            {" "}{printNum(fleet.instances?.length || 0)} VCF instances{drInstances > 0 ? ` (${drInstances} warm-standby)` : ""} ·
            {" "}{printNum(mgmtDomains)} mgmt + {printNum(wldDomains)} workload domains ·
            {" "}{printNum(totalClusters)} clusters
          </td></tr>
          <tr><th>Total hosts</th><td>{printNum(fleetResult.totalHosts)}</td></tr>
          <tr><th>Total licensed cores</th><td>{printNum(fleetResult.totalCores)}</td></tr>
          <tr><th>vSAN entitlement</th><td>{printNum(fleetResult.entitlementTib, 0)} TiB ({printNum(fleetResult.totalCores)} cores × 1 TiB/core)</td></tr>
          <tr><th>Fleet raw vSAN</th><td>{printNum(fleetResult.fleetRawTib, 1)} TiB</td></tr>
          <tr><th>Add-on vSAN required</th><td>{fleetResult.addonTib > 0 ? `${printNum(fleetResult.addonTib, 1)} TiB` : "None — within entitlement"}</td></tr>
        </tbody>
      </table>
      <PrintDesignHighlights fleet={fleet} />
      <h3 className="print-h3">Sites</h3>
      <table className="print-table">
        <thead>
          <tr><th>Name</th><th>Location</th><th>Region</th><th>Role</th></tr>
        </thead>
        <tbody>
          {(fleet.sites || []).map((s) => (
            <tr key={s.id}>
              <td>{s.name || "—"}</td>
              <td>{s.location || "—"}</td>
              <td>{s.region || "—"}</td>
              <td>{s.siteRole || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PrintApplianceStackTable({ stack, title, vcfVersion = DEFAULT_VCF_VERSION_LEGACY }) {
  if (!stack || stack.length === 0) {
    return (
      <div className="print-empty">{title}: no appliances configured</div>
    );
  }
  const totals = stackTotals(stack, vcfVersion);
  return (
    <div className="print-stack-block">
      <h4 className="print-h4">{title}</h4>
      <table className="print-table">
        <thead>
          <tr>
            <th>Appliance</th>
            <th>Role</th>
            <th>Size</th>
            <th>Count</th>
            <th>vCPU</th>
            <th>RAM (GB)</th>
            <th>Disk (GB)</th>
          </tr>
        </thead>
        <tbody>
          {stack.map((entry) => {
            const def = APPLIANCE_DB[entry.id];
            if (!def) return null;
            const sz = applianceSize(def, entry.size, vcfVersion) || applianceSize(def, def.defaultSize, vcfVersion);
            return (
              <tr key={entry.key}>
                <td>{def.label}</td>
                <td>{entry.role || "—"}</td>
                <td>{entry.size}</td>
                <td>{printNum(entry.instances)}</td>
                <td>{printNum(sz.vcpu * entry.instances)}</td>
                <td>{printNum(sz.ram * entry.instances)}</td>
                <td>{printNum(applianceEntryDisk(entry, def, sz) * entry.instances)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}><strong>Totals</strong></td>
            <td><strong>{printNum(totals.vcpu)}</strong></td>
            <td><strong>{printNum(totals.ram)}</strong></td>
            <td><strong>{printNum(totals.disk)}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PrintClusterStatRow({ cluster, result }) {
  return (
    <div className="print-cluster-stats">
      <div className="print-stat">
        <div className="print-stat-value">{printNum(result.finalHosts)}</div>
        <div className="print-stat-label">Hosts</div>
      </div>
      <div className="print-stat">
        <div className="print-stat-value">{printNum(result.licensedCores)}</div>
        <div className="print-stat-label">Licensed Cores</div>
      </div>
      <div className="print-stat">
        <div className="print-stat-value">{printNum(result.rawTib, 1)}</div>
        <div className="print-stat-label">TiB Raw vSAN</div>
      </div>
      <div className="print-stat">
        <div className="print-stat-value print-stat-value-sm">{result.limiter || "—"}</div>
        <div className="print-stat-label">Limiter</div>
      </div>
    </div>
  );
}

function PrintClusterCompactSummary({ cluster, result }) {
  const h = cluster.host || {};
  const policy = POLICIES[cluster.storage?.policy];
  const totalCores = printNum((h.cpuQty || 0) * (h.coresPerCpu || 0));
  const cpuLine = `${h.cpuQty} × ${h.coresPerCpu}-core (${totalCores} cores${h.hyperthreadingEnabled ? `, HT on` : `, HT off`})`;
  const nvmeLine = `${h.nvmeQty} × ${h.nvmeSizeTb} TB (${printNum((h.nvmeQty || 0) * (h.nvmeSizeTb || 0), 2)} TB raw)`;
  const floorsLine = `CPU ${printNum(result.floors?.cpuHosts)} · RAM ${printNum(result.floors?.ramHosts)} · Storage ${printNum(result.floors?.storageHosts)} · Policy ${printNum(result.floors?.policyMin)}${result.floors?.manualOverride ? ` · Manual ${printNum(result.floors?.manualOverride)}` : ""}`;
  const demandLine = `${printNum(result.demand?.vcpu)} vCPU · ${printNum(result.demand?.ram, 1)} GB · ${printNum(result.demand?.disk)} GB disk`;
  return (
    <div className="print-cluster-summary">
      <div className="print-cluster-col">
        <div className="print-cluster-col-h">Per host</div>
        <dl className="print-dl">
          <dt>CPU</dt><dd>{cpuLine}</dd>
          <dt>RAM</dt><dd>{printNum(h.ramGb)} GB</dd>
          <dt>NVMe</dt><dd>{nvmeLine}</dd>
          <dt>Oversub</dt><dd>vCPU {h.cpuOversub}:1 · RAM {h.ramOversub}:1 · Reserve {h.reservePct}%</dd>
        </dl>
      </div>
      <div className="print-cluster-col">
        <div className="print-cluster-col-h">Sizing</div>
        <dl className="print-dl">
          <dt>Floors</dt><dd>{floorsLine}</dd>
          <dt>Demand</dt><dd>{demandLine}</dd>
          <dt>Policy</dt><dd>{policy?.label || cluster.storage?.policy} (FTT={policy?.ftt}, min {policy?.minHosts})</dd>
          {result.failover && (
            <>
              <dt>Failover</dt>
              <dd>
                A: <span className={`print-verdict-${result.failover.siteA.verdict}`}>{result.failover.siteA.verdict}</span> ({result.failover.siteA.hosts}h) ·
                B: <span className={`print-verdict-${result.failover.siteB.verdict}`}>{result.failover.siteB.verdict}</span> ({result.failover.siteB.hosts}h)
              </dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}

function PrintT0Gateways({ cluster }) {
  const t0s = cluster.t0Gateways || [];
  if (t0s.length === 0) return null;
  return (
    <div className="print-stack-block">
      <h4 className="print-h4">T0 Gateways</h4>
      <table className="print-table">
        <thead>
          <tr><th>Name</th><th>HA mode</th><th>Local ASN</th><th>Edge nodes</th><th>BGP peers</th><th>Stateful</th></tr>
        </thead>
        <tbody>
          {t0s.map((t0) => {
            const mode = T0_HA_MODES[t0.haMode];
            return (
              <tr key={t0.id}>
                <td>{t0.name || "—"}</td>
                <td>{mode?.label || t0.haMode}</td>
                <td>{t0.asnLocal != null ? printNum(t0.asnLocal) : "—"}</td>
                <td>{(t0.edgeNodeKeys || []).length}</td>
                <td>{(t0.bgpPeers || []).length}</td>
                <td>{t0.stateful ? "Yes" : "No"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PrintNicVdsTable({ cluster }) {
  const nets = cluster.networks || {};
  const vds = nets.vds || [];
  if (vds.length === 0) return null;
  return (
    <table className="print-table">
      <thead>
        <tr><th>vDS</th><th>Uplinks</th><th>MTU</th></tr>
      </thead>
      <tbody>
        {vds.map((v, i) => (
          <tr key={i}>
            <td>{v.name}</td>
            <td>{(v.uplinks || []).join(", ")}</td>
            <td>{printNum(v.mtu)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PrintNicLayout({ cluster }) {
  const nets = cluster.networks || {};
  const vds = nets.vds || [];
  if (vds.length === 0) return null;
  // Pre-filter the per-network rows so we don't emit an empty header-only
  // table when no networks are configured (the common case for designs
  // that haven't filled in VLAN/subnet/pool yet).
  const netRows = [
    { key: "mgmt", label: "Management" },
    { key: "vmotion", label: "vMotion" },
    { key: "vsan", label: "vSAN" },
    { key: "hostTep", label: "Host TEP" },
    { key: "edgeTep", label: "Edge TEP" },
  ]
    .map(({ key, label }) => {
      const n = nets[key] || {};
      if (n.vlan == null && (!n.pool || !n.pool.start)) return null;
      const pool = n.pool && n.pool.start ? `${n.pool.start} – ${n.pool.end}` : (n.useDhcp ? "DHCP" : "—");
      return { key, label, n, pool };
    })
    .filter(Boolean);
  return (
    <div className="print-stack-block">
      <h4 className="print-h4 print-keep-with-next">Network · NIC profile {nets.nicProfileId}</h4>
      {netRows.length > 0 && (
        <table className="print-table">
          <thead>
            <tr><th>Network</th><th>VLAN</th><th>Subnet</th><th>Gateway</th><th>MTU</th><th>Pool</th></tr>
          </thead>
          <tbody>
            {netRows.map(({ key, label, n, pool }) => (
              <tr key={key}>
                <td>{label}</td>
                <td>{n.vlan != null ? printNum(n.vlan) : "—"}</td>
                <td>{n.subnet || "—"}</td>
                <td>{n.gateway || "—"}</td>
                <td>{n.mtu != null ? printNum(n.mtu) : "—"}</td>
                <td>{pool}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PrintIpPlan({ cluster, fleet, instance, domain, result }) {
  if (!cluster.networks?.mgmt?.pool?.start) return null;
  const ipPlan = allocateClusterIps(cluster, result.finalHosts, { fleet, instance, domain });
  if (!ipPlan.hosts || ipPlan.hosts.length === 0) return null;
  return (
    <div className="print-stack-block">
      <h4 className="print-h4">Per-host IP plan</h4>
      <table className="print-table print-ip-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Hostname</th>
            <th>Mgmt IP</th>
            <th>vMotion</th>
            <th>vSAN</th>
            <th>TEP</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {ipPlan.hosts.map((h) => (
            <tr key={h.index}>
              <td>{h.index}</td>
              <td>{h.hostname || "—"}</td>
              <td>{h.mgmtIp || "—"}</td>
              <td>{h.vmotionIp || "—"}</td>
              <td>{h.vsanIp || "—"}</td>
              <td>{h.hostTepIps ? h.hostTepIps.join(", ") : "DHCP"}</td>
              <td>{h.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PrintClusterSection({ cluster, result, fleet, instance, domain, isMgmt }) {
  const hasT0s = (cluster.t0Gateways || []).length > 0;
  return (
    <div className="print-cluster">
      {/* Identity bundle — header + hardware + sizing stay together
          (page-break-inside: avoid). Everything below can flow. */}
      <div className="print-cluster-identity">
        <h3 className={`print-h3 print-keep-with-next ${isMgmt ? "print-h3-cluster-mgmt" : "print-h3-cluster-workload"}`}>
          {isMgmt ? "◆ Mgmt cluster" : "◆ Workload cluster"} — {cluster.name}
          {cluster.preExisting && <span className="print-badge">Pre-existing</span>}
        </h3>
        <PrintClusterStatRow cluster={cluster} result={result} />
        <PrintClusterCompactSummary cluster={cluster} result={result} />
      </div>
      <PrintApplianceStackTable stack={cluster.infraStack || []} title="In-cluster infra stack" vcfVersion={fleet?.vcfVersion} />
      <PrintT0Gateways cluster={cluster} />
      {/* Plan 9 — vDS table + NIC topology SVG side-by-side. The wider
          per-network VLAN/subnet table stays full-width below via
          PrintNicLayout. Reuses NicDiagram from the editor so output
          matches the on-screen render exactly. */}
      <div className="print-stack-block print-network-row">
        <div className="print-network-col print-network-col-table">
          <h4 className="print-h4 print-keep-with-next">vDS Layout</h4>
          <PrintNicVdsTable cluster={cluster} />
        </div>
        <div className="print-network-col print-network-col-diagram print-diagram">
          <h4 className="print-h4">Physical NIC Topology</h4>
          <NicDiagram cluster={cluster} label={cluster.name} />
        </div>
      </div>
      <PrintNicLayout cluster={cluster} />
      {hasT0s && (
        <div className="print-stack-block print-diagram">
          <h4 className="print-h4">NSX Edge / T0 Topology</h4>
          <T0Diagram cluster={cluster} label={cluster.name} />
        </div>
      )}
      <PrintIpPlan cluster={cluster} fleet={fleet} instance={instance} domain={domain} result={result} />
    </div>
  );
}

function PrintDomainSection({ domain, domainResult, fleet, instance }) {
  const isMgmt = domain.type === "mgmt";
  const placement =
    domain.placement === "stretched" && Array.isArray(domain.stretchSiteIds) && domain.stretchSiteIds.length === 2
      ? `Stretched · ${(fleet.sites || []).find((s) => s.id === domain.stretchSiteIds[0])?.name || domain.stretchSiteIds[0]} ↔ ${(fleet.sites || []).find((s) => s.id === domain.stretchSiteIds[1])?.name || domain.stretchSiteIds[1]}`
      : domain.localSiteId
        ? `Local · ${(fleet.sites || []).find((s) => s.id === domain.localSiteId)?.name || domain.localSiteId}`
        : "Local · (no site)";
  const componentsClusterName = !isMgmt && (() => {
    const target = (instance.domains || [])
      .flatMap((d) => d.clusters || [])
      .find((c) => c.id === domain.componentsClusterId);
    return target ? target.name : "default mgmt cluster";
  })();
  return (
    <div className="print-domain">
      <h3 className={`print-h3 ${isMgmt ? "print-h3-mgmt" : "print-h3-workload"}`}>
        {isMgmt ? "▸ Management Domain" : "▸ Workload Domain"} — {domain.name}
        {domain.imported && <span className="print-badge print-badge-amber">⌂ Brownfield</span>}
      </h3>
      <div className="print-chip-row">
        <span className="print-chip"><span className="print-chip-k">Type</span> {isMgmt ? "Management" : "Workload"}</span>
        <span className="print-chip"><span className="print-chip-k">Placement</span> {placement}</span>
        {domain.placement === "stretched" && (
          <span className="print-chip"><span className="print-chip-k">Split</span> {domain.hostSplitPct}% / {100 - (domain.hostSplitPct ?? 50)}%</span>
        )}
        {!isMgmt && (
          <span className="print-chip"><span className="print-chip-k">Components</span> → {componentsClusterName}</span>
        )}
      </div>
      {!isMgmt && domain.wldStack && domain.wldStack.length > 0 && (
        <PrintApplianceStackTable stack={domain.wldStack} title="Workload-domain components (managed by mgmt domain)" vcfVersion={fleet?.vcfVersion} />
      )}
      <div className="print-clusters">
        {domain.clusters.map((c, i) => (
          <PrintClusterSection
            key={c.id}
            cluster={c}
            result={domainResult.clusterResults[i]}
            fleet={fleet}
            instance={instance}
            domain={domain}
            isMgmt={isMgmt}
          />
        ))}
      </div>
    </div>
  );
}

// Inline SVG renderers for the print document. These reuse the same
// computeTopologyLayout / computePhysicalLayout layout helpers and the
// shared TopologyBox / TopologyConnector / TOPOLOGY_COLORS constants
// that the on-screen TopologyView uses, so the print output matches the
// editor's visual exactly. Browser print handles SVG natively (vector
// output, perfect font fidelity) so we don't need to rasterize anything.
function PrintLogicalTopology({ fleet, fleetResult }) {
  let layout;
  try {
    layout = computeTopologyLayout(fleet, fleetResult);
  } catch (err) {
    return null;
  }
  if (!layout || layout.boxes.length === 0) return null;
  return (
    <section className="print-page print-section print-landscape">
      <h2 className="print-h2">Fleet Topology — Logical View</h2>
      <p className="print-section-intro">
        Hierarchy of fleet → site → instance → mgmt/workload domain → cluster.
        Dashed blue lines indicate stretched relationships. Rendered landscape
        so the full hierarchy fits on one page.
      </p>
      <div className="print-svg-container">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMidYMid meet"
          className="print-svg"
        >
          {layout.connectors.map((conn, i) => (
            <TopologyConnector key={`c-${i}`} from={conn.from} to={conn.to} />
          ))}
          {(layout.stretchedConnectors || []).map((conn, i) => (
            <TopologyConnector key={`sc-${i}`} from={conn.from} to={conn.to} dashed kind={conn.kind} />
          ))}
          {layout.boxes.map((box) => (
            <TopologyBox key={box.id} box={box} />
          ))}
        </svg>
      </div>
    </section>
  );
}

// Per-site cropped SVG. Kept available for future use (e.g. an optional
// "per-site detail pages" mode), but the default Plan 9 print path uses
// PrintPhysicalFleetSvg below to render all sites on a single landscape
// page so the user gets a fleet-wide view at a glance.
function PrintPhysicalSiteSvg({ site }) {
  const verdictColor = (v) => v === "green" ? "#16a34a" : v === "yellow" ? "#ca8a04" : "#dc2626";
  // viewBox crops to this site only. Use a small horizontal pad so the
  // outer site rect doesn't get clipped by stroke width.
  const pad = 4;
  const vbX = site.x - pad;
  const vbY = 0;
  const vbW = site.width + pad * 2;
  const vbH = site.height + pad * 2;
  return (
    <svg
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMinYMin meet"
      className="print-svg print-svg-site"
    >
      <rect x={site.x} y={site.y} width={site.width} height={site.height}
        rx={8} fill={TOPOLOGY_COLORS.site.fill} stroke={TOPOLOGY_COLORS.site.stroke} strokeWidth={2} />
      <text x={site.x + 14} y={site.y + 22}
        fontFamily="Inter, system-ui, sans-serif" fontSize={15} fontWeight="700"
        fill={TOPOLOGY_COLORS.site.text}>{truncate(site.name, 28)}</text>
      <text x={site.x + site.width - 14} y={site.y + 22}
        textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize={9}
        fill={TOPOLOGY_COLORS.site.text} opacity={0.6}>{site.location}</text>
      {site.domains.map((dom) => {
        const dc = TOPOLOGY_COLORS[dom.type === "mgmt" ? "mgmt" : "workload"];
        return (
          <g key={`${site.id}-${dom.id}`}>
            <rect x={dom.x} y={site.y + dom.y} width={dom.width} height={dom.height}
              rx={6} fill={dc.fill} stroke={dc.stroke} strokeWidth={1.2} />
            <text x={dom.x + 10} y={site.y + dom.y + 18}
              fontFamily="Inter, system-ui, sans-serif" fontSize={11} fontWeight="600"
              fill={dc.text}>
              {dom.imported ? "⌂ " : ""}{truncate(dom.name, dom.imported ? 30 : 32)}
            </text>
            {dom.placement === "stretched" && (
              <text x={dom.x + dom.width - 10} y={site.y + dom.y + 18}
                textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize={8}
                fill="#2563eb" fontWeight="500">↔ {dom.sharePct}%</text>
            )}
            {dom.clusters.map((clu) => {
              const cc = TOPOLOGY_COLORS.cluster;
              return (
                <g key={`${site.id}-${dom.id}-${clu.id}`}>
                  <rect x={clu.x} y={site.y + clu.y} width={clu.width} height={clu.height}
                    rx={4} fill={cc.fill} stroke={cc.stroke} strokeWidth={1} />
                  <text x={clu.x + 8} y={site.y + clu.y + 16}
                    fontFamily="Inter, system-ui, sans-serif" fontSize={11} fontWeight="600"
                    fill={cc.text}>{truncate(clu.name, 26)}</text>
                  <text x={clu.x + 8} y={site.y + clu.y + 30}
                    fontFamily="IBM Plex Mono, monospace" fontSize={9}
                    fill={cc.text} opacity={0.7}>Limit: {clu.limiter}</text>
                  {clu.failover && (
                    <g>
                      <circle cx={clu.x + clu.width - 20} cy={site.y + clu.y + 16}
                        r={5} fill={verdictColor(clu.failover.siteA.verdict)} />
                      <circle cx={clu.x + clu.width - 8} cy={site.y + clu.y + 16}
                        r={5} fill={verdictColor(clu.failover.siteB.verdict)} />
                    </g>
                  )}
                  {(clu.appliances || []).map((app, ai) => {
                    const ac = TOPOLOGY_COLORS.appliance;
                    // Plan 9 — render appliance pills the same way the
                    // on-screen Physical view does: full single-column
                    // pill with label (+ ×N when count>1) and right-aligned
                    // cpu/RAM resources. Computed positions mirror the
                    // editor's PhysicalTopologyView rendering exactly.
                    const ax = clu.x + PHYS_CLUSTER_PAD;
                    const pillW = clu.width - PHYS_CLUSTER_PAD * 2;
                    const ay = site.y + clu.y + PHYS_CLUSTER_HEADER_H + PHYS_HOST_BADGE_H + 4 +
                      ai * (PHYS_APPLIANCE_H + PHYS_APPLIANCE_GAP);
                    const resText = `${app.vcpu}cpu ${app.ram}GB`;
                    return (
                      <g key={`app-${ai}`}>
                        <rect x={ax} y={ay} width={pillW} height={PHYS_APPLIANCE_H}
                          rx={3} fill={ac.fill} stroke={ac.stroke} strokeWidth={0.8} />
                        <text x={ax + 6} y={ay + 16}
                          fontFamily="Inter, system-ui, sans-serif" fontSize={10} fontWeight="500"
                          fill={ac.text}>
                          {truncate(app.label, 26)}{app.count > 1 ? ` ×${app.count}` : ""}
                        </text>
                        <text x={ax + pillW - 6} y={ay + 16}
                          textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize={9}
                          fill={ac.text} opacity={0.55}>{resText}</text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function PrintPhysicalTopology({ fleet, fleetResult }) {
  let layout;
  try {
    layout = computePhysicalLayout(fleet, fleetResult);
  } catch (err) {
    return null;
  }
  if (!layout || layout.sites.length === 0) return null;
  // Plan 9 — render the entire fleet's physical layout in a single SVG on
  // a landscape page. Each <PrintPhysicalSiteSvg> uses its own viewBox,
  // but here we want all sites visible at once so we render them inline
  // within the same SVG as the editor does, then let CSS scale to fit
  // the landscape page width.
  return (
    <section className="print-page print-section print-landscape">
      <h2 className="print-h2">Fleet Topology — Physical View</h2>
      <p className="print-section-intro">
        Rack-level layout: cluster placement, appliance VMs per cluster,
        stretched site links (dashed blue), and vSAN witnesses.
      </p>
      <PrintPhysicalFleetSvg layout={layout} />
    </section>
  );
}

// Combined fleet-wide physical layout SVG (all sites side-by-side).
// Mirrors the screen render structure exactly so the printed output
// looks identical to what the user sees in the editor's Physical view.
function PrintPhysicalFleetSvg({ layout }) {
  const verdictColor = (v) => v === "green" ? "#16a34a" : v === "yellow" ? "#ca8a04" : "#dc2626";
  return (
    <div className="print-svg-container">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid meet"
        className="print-svg print-svg-fleet"
      >
        {(layout.stretchedBands || []).map((band, i) => {
          const midX = (band.from.x + band.to.x) / 2;
          return (
            <g key={`band-${i}`}>
              <path
                d={`M ${band.from.x} ${band.from.y} L ${band.to.x} ${band.to.y}`}
                stroke="#2563eb" strokeWidth={2} strokeDasharray="8 4" fill="none"
              />
              <rect x={midX - 50} y={Math.min(band.from.y, band.to.y) - 14}
                width={100} height={18} rx={9} fill="#eff6ff" stroke="#2563eb" strokeWidth={0.8} />
              <text x={midX} y={Math.min(band.from.y, band.to.y) - 2}
                textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize={8}
                fill="#2563eb" fontWeight="500">{band.label}</text>
            </g>
          );
        })}
        {layout.sites.map((site) => (
          <g key={site.id}>
            <rect x={site.x} y={site.y} width={site.width} height={site.height}
              rx={8} fill={TOPOLOGY_COLORS.site.fill} stroke={TOPOLOGY_COLORS.site.stroke} strokeWidth={2} />
            <text x={site.x + 14} y={site.y + 22}
              fontFamily="Inter, system-ui, sans-serif" fontSize={15} fontWeight="700"
              fill={TOPOLOGY_COLORS.site.text}>{truncate(site.name, 28)}</text>
            <text x={site.x + site.width - 14} y={site.y + 22}
              textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize={9}
              fill={TOPOLOGY_COLORS.site.text} opacity={0.6}>{site.location}</text>
            {site.domains.map((dom) => {
              const dc = TOPOLOGY_COLORS[dom.type === "mgmt" ? "mgmt" : "workload"];
              return (
                <g key={`${site.id}-${dom.id}`}>
                  <rect x={dom.x} y={site.y + dom.y} width={dom.width} height={dom.height}
                    rx={6} fill={dc.fill} stroke={dc.stroke} strokeWidth={1.2} />
                  <text x={dom.x + 10} y={site.y + dom.y + 18}
                    fontFamily="Inter, system-ui, sans-serif" fontSize={11} fontWeight="600"
                    fill={dc.text}>
                    {dom.imported ? "⌂ " : ""}{truncate(dom.name, dom.imported ? 30 : 32)}
                  </text>
                  {dom.placement === "stretched" && (
                    <text x={dom.x + dom.width - 10} y={site.y + dom.y + 18}
                      textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize={8}
                      fill="#2563eb" fontWeight="500">↔ {dom.sharePct}%</text>
                  )}
                  {dom.clusters.map((clu) => {
                    const cc = TOPOLOGY_COLORS.cluster;
                    return (
                      <g key={`${site.id}-${dom.id}-${clu.id}`}>
                        <rect x={clu.x} y={site.y + clu.y} width={clu.width} height={clu.height}
                          rx={4} fill={cc.fill} stroke={cc.stroke} strokeWidth={1} />
                        <text x={clu.x + 8} y={site.y + clu.y + 16}
                          fontFamily="Inter, system-ui, sans-serif" fontSize={11} fontWeight="600"
                          fill={cc.text}>{truncate(clu.name, 26)}</text>
                        <text x={clu.x + 8} y={site.y + clu.y + 30}
                          fontFamily="IBM Plex Mono, monospace" fontSize={9}
                          fill={cc.text} opacity={0.7}>Limit: {clu.limiter}</text>
                        {clu.failover && (
                          <g>
                            <circle cx={clu.x + clu.width - 20} cy={site.y + clu.y + 16}
                              r={5} fill={verdictColor(clu.failover.siteA.verdict)} />
                            <circle cx={clu.x + clu.width - 8} cy={site.y + clu.y + 16}
                              r={5} fill={verdictColor(clu.failover.siteB.verdict)} />
                          </g>
                        )}
                        <rect x={clu.x + 6} y={site.y + clu.y + PHYS_CLUSTER_HEADER_H - 8}
                          width={clu.width - 12} height={PHYS_HOST_BADGE_H} rx={3}
                          fill="#fff" stroke={cc.stroke} strokeWidth={0.5} opacity={0.7} />
                        <text x={clu.x + 14} y={site.y + clu.y + PHYS_CLUSTER_HEADER_H + 8}
                          fontFamily="IBM Plex Mono, monospace" fontSize={9}
                          fill={cc.text} fontWeight="600">
                          {clu.hostCount} hosts · {fmt(clu.cores)} cores · {(clu.rawTib || 0).toFixed(1)} TiB
                        </text>
                        {(clu.appliances || []).map((app, ai) => {
                          const ac = TOPOLOGY_COLORS.appliance;
                          const ax = clu.x + PHYS_CLUSTER_PAD;
                          const pillW = clu.width - PHYS_CLUSTER_PAD * 2;
                          const ay = site.y + clu.y + PHYS_CLUSTER_HEADER_H + PHYS_HOST_BADGE_H + 4 +
                            ai * (PHYS_APPLIANCE_H + PHYS_APPLIANCE_GAP);
                          const resText = `${app.vcpu}cpu ${app.ram}GB`;
                          return (
                            <g key={`app-${ai}`}>
                              <rect x={ax} y={ay} width={pillW} height={PHYS_APPLIANCE_H}
                                rx={3} fill={ac.fill} stroke={ac.stroke} strokeWidth={0.8} />
                              <text x={ax + 6} y={ay + 16}
                                fontFamily="Inter, system-ui, sans-serif" fontSize={10} fontWeight="500"
                                fill={ac.text}>
                                {truncate(app.label, 26)}{app.count > 1 ? ` ×${app.count}` : ""}
                              </text>
                              <text x={ax + pillW - 6} y={ay + 16}
                                textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize={9}
                                fill={ac.text} opacity={0.55}>{resText}</text>
                            </g>
                          );
                        })}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>
        ))}
        {(layout.witnesses || []).map((w) => {
          const wc = TOPOLOGY_COLORS.witness;
          return (
            <g key={w.id}>
              <rect x={w.x} y={w.y} width={w.width} height={w.height}
                rx={6} fill={wc.fill} stroke={wc.stroke} strokeWidth={1.5} strokeDasharray="4 2" />
              <text x={w.x + w.width / 2} y={w.y + 18}
                textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontSize={11} fontWeight="600"
                fill={wc.text}>{truncate(w.label, 22)}</text>
              <text x={w.x + w.width / 2} y={w.y + 32}
                textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize={8}
                fill={wc.text} opacity={0.7}>{w.size} · {w.instances} VM(s)</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function PrintPerSiteCapacity({ fleet, fleetResult }) {
  // Aggregate per-site host count + raw TiB by walking projected domains.
  const rows = [];
  for (const sr of fleetResult.siteResults || []) {
    let hosts = 0, raw = 0, instances = new Set();
    for (const proj of sr.projections || []) {
      instances.add(proj.instance.id);
      for (const pd of proj.projectedDomains || []) {
        for (const pc of pd.projectedClusters || []) {
          hosts += pc.hostsHere;
          raw += pc.rawTibHere || 0;
        }
      }
    }
    rows.push({
      site: sr.site,
      hosts,
      raw,
      instances: instances.size,
    });
  }
  if (rows.length === 0) return null;
  return (
    <section className="print-page print-section">
      <h2 className="print-h2">Per-Site Capacity</h2>
      <p className="print-empty" style={{ fontStyle: "normal", color: "#475569" }}>
        Resource projections broken down by physical site. Stretched-cluster
        hosts are split per the cluster's host distribution.
      </p>
      <table className="print-table">
        <thead>
          <tr>
            <th>Site</th>
            <th>Location</th>
            <th>Region</th>
            <th>Role</th>
            <th>VCF instances</th>
            <th>Hosts</th>
            <th>Raw vSAN (TiB)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.site.id}>
              <td>{r.site.name || "—"}</td>
              <td>{r.site.location || "—"}</td>
              <td>{r.site.region || "—"}</td>
              <td>{r.site.siteRole || "—"}</td>
              <td>{printNum(r.instances)}</td>
              <td>{printNum(r.hosts)}</td>
              <td>{printNum(r.raw, 1)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}><strong>Fleet totals</strong></td>
            <td><strong>{printNum(fleet.instances?.length || 0)}</strong></td>
            <td><strong>{printNum(rows.reduce((s, r) => s + r.hosts, 0))}</strong></td>
            <td><strong>{printNum(rows.reduce((s, r) => s + r.raw, 0), 1)}</strong></td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

function PrintInstanceSection({ instance, instanceResult, fleet, isInitial }) {
  const profile = DEPLOYMENT_PROFILES[instance.deploymentProfile || "ha"];
  const siteNames = (instance.siteIds || [])
    .map((sid) => (fleet.sites || []).find((s) => s.id === sid)?.name || sid)
    .join(", ");
  return (
    <section className="print-page print-section">
      <h2 className="print-h2">
        Instance — {instance.name}
        {isInitial && <span className="print-badge">★ Initial</span>}
        {instance.drPosture === "warm-standby" && <span className="print-badge print-badge-amber">DR · warm-standby</span>}
      </h2>
      <table className="print-kv-table">
        <tbody>
          <tr><th>Deployment profile</th><td>{profile?.label || instance.deploymentProfile}</td></tr>
          <tr><th>Sites</th><td>{siteNames || "—"}</td></tr>
          <tr><th>Total hosts</th><td>{printNum(instanceResult.totalHosts)}</td></tr>
          <tr><th>Total licensed cores</th><td>{printNum(instanceResult.totalCores)}</td></tr>
          <tr><th>Raw vSAN</th><td>{printNum(instanceResult.totalRawTib, 1)} TiB</td></tr>
          {instance.witnessEnabled && instanceResult.witness && (
            <tr><th>vSAN Witness</th><td>{instance.witnessSize} · {instanceResult.witness.instances} witness(es) · {printNum(instanceResult.witness.vcpu)} vCPU / {printNum(instanceResult.witness.ram)} GB / {printNum(instanceResult.witness.disk)} GB</td></tr>
          )}
        </tbody>
      </table>
      {instance.domains.map((d, i) => (
        <PrintDomainSection
          key={d.id}
          domain={d}
          domainResult={instanceResult.domainResults[i]}
          fleet={fleet}
          instance={instance}
        />
      ))}
    </section>
  );
}

function PrintNetworkSection({ fleet }) {
  const nc = fleet.networkConfig || {};
  const dns = nc.dns || {};
  const ntp = nc.ntp || {};
  const naming = fleet.namingConfig || {};
  return (
    <section className="print-page print-section">
      <h2 className="print-h2">Network &amp; Naming Configuration</h2>
      <h3 className="print-h3">Fleet network services</h3>
      <table className="print-kv-table">
        <tbody>
          <tr><th>DNS servers</th><td>{(dns.servers || []).join(", ") || "—"}</td></tr>
          <tr><th>DNS primary domain</th><td>{dns.primaryDomain || "—"}</td></tr>
          <tr><th>DNS search domains</th><td>{(dns.searchDomains || []).join(", ") || "—"}</td></tr>
          <tr><th>NTP servers</th><td>{(ntp.servers || []).join(", ") || "—"}</td></tr>
          <tr><th>NTP timezone</th><td>{ntp.timezone || "UTC"}</td></tr>
          <tr><th>Syslog servers</th><td>{((nc.syslog && nc.syslog.servers) || []).join(", ") || "—"}</td></tr>
        </tbody>
      </table>
      {(naming.hostTemplate || naming.vdsTemplate) && (
        <>
          <h3 className="print-h3">Naming convention templates</h3>
          <table className="print-kv-table">
            <tbody>
              <tr><th>Host template</th><td>{naming.hostTemplate || "(empty)"}</td></tr>
              <tr><th>vDS template</th><td>{naming.vdsTemplate || "(empty)"}</td></tr>
              <tr><th>Prefix</th><td>{naming.prefix || "—"}</td></tr>
              <tr><th>Postfix</th><td>{naming.postfix || "—"}</td></tr>
              <tr><th>Sequence start</th><td>{naming.seqStart != null ? printNum(naming.seqStart) : 1}</td></tr>
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function PrintValidationSection({ fleet, fleetResult }) {
  const issues = validateNetworkDesign(fleet, fleetResult) || [];
  const grouped = { error: [], critical: [], warn: [], info: [] };
  issues.forEach((iss) => {
    const sev = iss.severity || "info";
    (grouped[sev] || (grouped.info)).push(iss);
  });
  if (issues.length === 0) {
    return (
      <section className="print-page print-section">
        <h2 className="print-h2">Validation Issues</h2>
        <p className="print-empty">No validation issues detected.</p>
      </section>
    );
  }
  return (
    <section className="print-page print-section">
      <h2 className="print-h2">Validation Issues</h2>
      {[
        { sev: "critical", label: "Critical (blocks deployment)", className: "print-issue-critical" },
        { sev: "error", label: "Errors", className: "print-issue-error" },
        { sev: "warn", label: "Warnings", className: "print-issue-warn" },
        { sev: "info", label: "Informational", className: "print-issue-info" },
      ].map(({ sev, label, className }) => {
        if (grouped[sev].length === 0) return null;
        return (
          <div key={sev} className="print-stack-block">
            <h3 className="print-h3">{label} ({grouped[sev].length})</h3>
            <table className={`print-table ${className}`}>
              <thead>
                <tr><th>Rule</th><th>Message</th></tr>
              </thead>
              <tbody>
                {grouped[sev].map((iss, i) => (
                  <tr key={i}>
                    <td>{iss.ruleId || "—"}</td>
                    <td>{iss.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}

function PrintApplianceInventory({ fleet }) {
  // Aggregate counts across the fleet by appliance id.
  const counts = {};
  (fleet.instances || []).forEach((inst) => {
    (inst.domains || []).forEach((dom) => {
      (dom.clusters || []).forEach((cl) => {
        (cl.infraStack || []).forEach((e) => {
          if (!counts[e.id]) counts[e.id] = { count: 0, def: APPLIANCE_DB[e.id] };
          counts[e.id].count += e.instances || 0;
        });
      });
      (dom.wldStack || []).forEach((e) => {
        if (!counts[e.id]) counts[e.id] = { count: 0, def: APPLIANCE_DB[e.id] };
        counts[e.id].count += e.instances || 0;
      });
    });
  });
  const rows = Object.entries(counts)
    .filter(([, v]) => v.def && v.count > 0)
    .sort((a, b) => (a[1].def.label || "").localeCompare(b[1].def.label || ""));
  return (
    <section className="print-page print-section">
      <h2 className="print-h2">Fleet Appliance Inventory</h2>
      {rows.length === 0 ? (
        <p className="print-empty">No appliances configured.</p>
      ) : (
        <table className="print-table">
          <thead>
            <tr><th>Appliance</th><th>Rule</th><th>Total VMs across fleet</th></tr>
          </thead>
          <tbody>
            {rows.map(([id, { count, def }]) => (
              <tr key={id}>
                <td>{def.label}</td>
                <td>{def.ruleId || "—"}</td>
                <td>{printNum(count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PrintView({ fleet, fleetResult }) {
  return (
    <div className="print-view">
      <PrintCoverPage fleet={fleet} fleetResult={fleetResult} />
      <PrintTOC fleet={fleet} />
      <PrintExecutiveSummary fleet={fleet} fleetResult={fleetResult} />
      <PrintLogicalTopology fleet={fleet} fleetResult={fleetResult} />
      <PrintPhysicalTopology fleet={fleet} fleetResult={fleetResult} />
      {fleet.instances.map((inst, i) => (
        <PrintInstanceSection
          key={inst.id}
          instance={inst}
          instanceResult={fleetResult.instanceResults[i]}
          fleet={fleet}
          isInitial={i === 0}
        />
      ))}
      <PrintNetworkSection fleet={fleet} />
      <PrintPerSiteCapacity fleet={fleet} fleetResult={fleetResult} />
      <PrintValidationSection fleet={fleet} fleetResult={fleetResult} />
      <PrintApplianceInventory fleet={fleet} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP-LEVEL COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function VcfFleetSizer() {
  const [fleet, setFleet] = useState(newFleet());
  const [view, setView] = useState("editor"); // "editor" | "topology"
  const fileInputRef = useRef(null);
  const expandInputRef = useRef(null);
  // VCF-PATH-004 post-import banner (Plan 6) — populated when migration
  // auto-flips workload domains to imported (brownfield) based on legacy
  // WLD-cluster appliance placement. User dismisses to clear.
  const [autoImportedNotice, setAutoImportedNotice] = useState(null);

  const fleetResult = useMemo(() => sizeFleet(fleet), [fleet]);

  const exportConfig = () => {
    const config = {
      version: "vcf-sizer-v9",
      exportedAt: new Date().toISOString(),
      fleet,
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vcf-fleet-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportInstallerJson = () => {
    const result = emitInstallerJson(fleet, fleetResult);
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vcf-installer-spec-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportWorkbookCsv = () => {
    const sheets = emitWorkbookRows(fleet, fleetResult);
    const csvParts = sheets.map(function(s) {
      return "## " + s.sheet + "\n" + s.rows.map(function(r) { return r.join(","); }).join("\n");
    });
    const blob = new Blob([csvParts.join("\n\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vcf-workbook-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Plan 11 Phase 1a — cell-addressable workbook export. Produces a CSV
  // where each row is a (workbookVersion, sheet, cell, label, value) tuple
  // targeting the official VCF P&P Workbook for fleet.vcfVersion. Consumed
  // by scripts/stamp-workbook.py to produce a stamped .xlsx.
  const exportWorkbookCellMap = () => {
    const wbVersion = workbookVersionForFleet(fleet);
    const csv = emitWorkbookCellMapCsv(fleet, fleetResult);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vcf-${wbVersion}-cell-map-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importConfig = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target.result);
        const originalVersion = raw?.version || "unknown";
        const migrated = migrateFleet(raw);
        if (!migrated || !Array.isArray(migrated.sites) || !Array.isArray(migrated.instances)) {
          alert("Unrecognized config file format.");
          return;
        }
        // Plan 6 — capture auto-imported brownfield notice and strip the
        // transient marker before storing the fleet in state so the banner
        // doesn't leak into export or persist across sessions.
        const { _migrated, ...cleanFleet } = migrated;
        if (_migrated?.autoImportedDomains?.length) {
          setAutoImportedNotice({ domains: _migrated.autoImportedDomains });
        }
        // Plan 12 — defensively enforce VCF-version invariants: strip
        // wrong-version appliance entries (hand-edited JSON, future export
        // bugs) and ensure 9.1 fleets have VCFMS on the initial instance.
        const reconciled = reconcileFleetVersion(cleanFleet);
        setFleet(reconciled);
        if (originalVersion !== "vcf-sizer-v5") {
          alert(
            `Imported ${originalVersion} config and auto-migrated to v9. Stretched VCF instances that were previously duplicated across sites have been consolidated. Original file was not modified.`
          );
        }
      } catch (err) {
        alert("Failed to parse config: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // VCF-PATH-002 expand-fleet pathway: take the first instance from an
  // imported JSON and append it to the current fleet as a new instance.
  // Per-fleet appliances on the imported instance are stripped (they stay
  // on the current fleet's initial instance), and sites referenced by the
  // imported instance are carried over.
  const importAsNewInstance = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target.result);
        const migrated = migrateFleet(raw);
        if (!migrated?.instances?.length) {
          alert("Imported config has no instances to merge.");
          return;
        }
        // Plan 6 — surface the banner if migration auto-flipped any domains
        // in the source. Note: only domains owned by the merged-in instance
        // are visible after merge; filter to those.
        const sourceDomainIds = new Set((migrated.instances[0].domains || []).map((d) => d.id));
        const autoFlipped = (migrated._migrated?.autoImportedDomains || [])
          .filter((d) => sourceDomainIds.has(d.id));
        if (autoFlipped.length > 0) setAutoImportedNotice({ domains: autoFlipped });
        // Plan 12 — detect VCF version mismatch between the imported fleet
        // and the host fleet. If they differ, confirm with the user and
        // re-migrate the source instance to match the host version.
        let source = migrated.instances[0];
        const hostVersion = fleet.vcfVersion || DEFAULT_VCF_VERSION_LEGACY;
        const importedVersion = migrated.vcfVersion || DEFAULT_VCF_VERSION_LEGACY;
        if (hostVersion !== importedVersion) {
          if (!window.confirm(
            `VCF version mismatch on import:\n\n` +
            `• Host fleet is on VCF ${hostVersion}\n` +
            `• Imported instance is from a VCF ${importedVersion} fleet\n\n` +
            `Continue and re-migrate the imported instance to ${hostVersion}? ` +
            `(${importedVersion === "9.1" ? "VCFMS entries will be stripped" : "VCFMS entries will be added at default sizes"}.)`
          )) return;
          // Tag the source with its origin version so reconcileInstanceVersion
          // routes correctly, then re-migrate to the host version.
          source = reconcileInstanceVersion({ ...source, vcfVersion: importedVersion }, hostVersion);
        }
        // Import any sites the source instance refers to that aren't already
        // on this fleet. Match by name (ids differ across exports).
        const existingNames = new Set(fleet.sites.map((s) => s.name));
        const newSites = (migrated.sites || []).filter((s) => !existingNames.has(s.name));
        const allSites = [...fleet.sites, ...newSites];
        // Rewrite the source instance's siteIds to point at this fleet's
        // matching sites (by name).
        const byNameId = Object.fromEntries(allSites.map((s) => [s.name, s.id]));
        const sourceSiteIds = (source.siteIds || []).map((sid) => {
          const src = (migrated.sites || []).find((s) => s.id === sid);
          return src ? byNameId[src.name] : allSites[0]?.id;
        }).filter(Boolean);
        // Strip per-fleet appliances from the imported instance's stack —
        // fleet-level services already exist on the current fleet's initial
        // instance (VCF-INV-010 / VCF-PATH-002).
        const strippedDomains = (source.domains || []).map((d) => ({
          ...d,
          clusters: (d.clusters || []).map((c) => ({
            ...c,
            infraStack: (c.infraStack || []).filter((entry) => {
              const def = APPLIANCE_DB[entry.id];
              return def?.scope !== "per-fleet";
            }),
          })),
        }));
        const incoming = {
          ...source,
          id: "inst-" + cryptoKey(),   // fresh id to avoid collisions
          name: source.name + "-imported",
          siteIds: sourceSiteIds,
          domains: strippedDomains,
        };
        setFleet({
          ...fleet,
          sites: allSites,
          instances: [...fleet.instances, incoming],
          // Expand-fleet pathway is now implicit — leave current pathway
          // unchanged unless the user explicitly set "greenfield" and now
          // has multiple instances, in which case nudge to expand.
          deploymentPathway: fleet.deploymentPathway === "greenfield"
            ? "expand"
            : fleet.deploymentPathway,
        });
        alert(`Imported "${source.name}" as a new instance. Per-fleet appliances were stripped (they stay on the fleet's initial instance).`);
      } catch (err) {
        alert("Failed to merge config: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const resetAll = () => {
    if (confirm("Reset all inputs to defaults?")) {
      setFleet(newFleet());
    }
  };

  return (
    <div
      className="min-h-screen p-6 lg:p-10 text-slate-800 print-root"
      style={{
        background: "#f8fafc",
        fontFamily: '"Inter", system-ui, sans-serif',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .font-serif { font-family: 'Inter', system-ui, sans-serif; font-weight: 600; }
        .font-mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.3; }
        select option { background: #fff; }

        /* ─── Plan 8b — PRINT VIEW ─────────────────────────────────────── */
        /* Always-mounted PrintView; CSS controls visibility per medium. */
        .print-view { display: none; }

        @media print {
          /* @page rules: A4 default with conservative margins so headers
             and footers don't crowd content. Topology pages use landscape
             so wide hierarchy + multi-site rack diagrams fit on one page. */
          @page { size: A4; margin: 0.6in 0.5in; }
          @page topology { size: A4 landscape; margin: 0.4in 0.4in; }
          .print-landscape { page: topology; }

          /* Hide editor chrome inside .print-root. The React mount layer
             (<body> > <div id="root"> > <div class="print-root">) means we
             must NOT hide body-level children — that would also hide the
             React root and cascade-hide PrintView itself. */
          .print-root > *:not(.print-view),
          .no-print { display: none !important; }

          /* Reveal PrintView and force a clean light theme. */
          .print-view {
            display: block !important;
            background: #fff !important;
            color: #111 !important;
            font-family: 'Inter', system-ui, sans-serif;
            font-size: 10pt;
            line-height: 1.4;
          }

          /* Plan 9 polish — preserve background colors and accents in
             print output. Browsers strip backgrounds by default to save
             ink; print-color-adjust: exact (and the WebKit alias) opt
             back in. Without this, every colored band/tile/header bar
             would render as plain white. */
          .print-view, .print-view * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Each top-level section starts a new page. Domains and clusters
             flow inside their parent Instance section to avoid sparse pages. */
          .print-page { page-break-before: always; padding: 0; }
          .print-page:first-child { page-break-before: auto; }

          /* Heading "keep with next" — prevent a section header from being
             orphaned at the bottom of a page when its content flowed up.
             Combined with paragraph orphans/widows, this avoids the
             1-line page bottoms we saw in the v1 PDF. */
          .print-keep-with-next { page-break-after: avoid; }
          .print-page, .print-section { orphans: 3; widows: 3; }

          /* Cover page styling — colored band + large title + meta block. */
          .print-cover {
            display: flex; flex-direction: column; min-height: 9.5in;
            position: relative;
          }
          /* Plan 9 polish — colored gradient band at the top of the
             cover page so the deliverable doesn't open on plain white. */
          .print-cover-header {
            background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #0ea5e9 100%) !important;
            color: #fff !important;
            margin: -0.6in -0.5in 0 -0.5in;
            padding: 0.55in 0.5in 0.45in 0.5in;
          }
          .print-cover-header .print-eyebrow { color: #bae6fd !important; }
          .print-cover-header .print-title { color: #fff !important; }
          .print-cover-header .print-rule {
            border-color: rgba(255,255,255,0.4) !important;
          }
          .print-eyebrow {
            font-family: 'IBM Plex Mono', monospace;
            font-size: 9pt; letter-spacing: 0.3em; text-transform: uppercase;
            color: #2563eb;
          }
          .print-eyebrow-sm {
            font-size: 8pt; letter-spacing: 0.2em;
            color: #1e40af; margin-bottom: 0.5em;
          }
          .print-title {
            font-size: 30pt; font-weight: 700; color: #0f172a;
            margin: 0.3em 0; letter-spacing: -0.02em;
          }
          .print-rule { border-top: 1px solid #cbd5e1; margin: 0.8em 0; }
          .print-cover-fleet { margin: 0.5in 0 0.4in 0; }
          .print-cover-fleet-name {
            font-size: 22pt; color: #0f172a; font-weight: 600;
            border-left: 4px solid #2563eb;
            background: linear-gradient(90deg, #eff6ff 0%, #fff 60%) !important;
            padding: 0.3em 0.6em;
            border-radius: 0 4px 4px 0;
          }
          .print-cover-meta {
            font-family: 'IBM Plex Mono', monospace; font-size: 10pt;
            border-collapse: collapse; margin: 0.5em 0;
            background: #f8fafc !important;
            padding: 0.3em 0.5em;
            border-radius: 4px;
            border: 1px solid #e2e8f0;
          }
          .print-cover-meta th {
            text-align: left; padding: 0.35em 1.5em 0.35em 0.6em;
            color: #1e40af; font-weight: 600; vertical-align: top;
            text-transform: uppercase; font-size: 9pt; letter-spacing: 0.1em;
            white-space: nowrap;
          }
          .print-cover-meta td {
            padding: 0.35em 0.6em 0.35em 0;
            color: #0f172a; font-weight: 500;
          }
          .print-cover-scope {
            margin-top: 0.5in;
            border-top: 1px solid #e2e8f0;
            padding-top: 0.5em;
          }
          .print-cover-scope-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 0.5em;
            margin-top: 0.5em;
          }
          .print-stat {
            border: 1px solid #bfdbfe;
            border-left: 4px solid #2563eb;
            padding: 0.5em 0.7em;
            background: linear-gradient(135deg, #eff6ff 0%, #f0f9ff 100%) !important;
            border-radius: 0 3px 3px 0;
          }
          .print-stat-value {
            font-family: 'Inter', system-ui, sans-serif;
            font-size: 18pt; font-weight: 700; color: #1e3a8a;
            line-height: 1.1;
          }
          .print-stat-label {
            font-family: 'IBM Plex Mono', monospace;
            font-size: 8pt; color: #1e40af;
            text-transform: uppercase; letter-spacing: 0.06em;
            margin-top: 0.2em;
            font-weight: 500;
          }
          .print-stat-aux { color: #94a3b8; text-transform: none; letter-spacing: 0; }
          .print-stat-value-sm { font-size: 11pt; }

          /* Plan 9 — compact cluster stat row (HOSTS / CORES / RAW TIB /
             LIMITER) reuses .print-stat from the cover page but on a
             4-column grid sized for in-section density (smaller padding). */
          .print-cluster-stats {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 0.4em;
            margin: 0.4em 0 0.6em 0;
          }
          .print-cluster-stats .print-stat { padding: 0.35em 0.5em; }
          .print-cluster-stats .print-stat-value { font-size: 14pt; }

          /* Side-by-side hardware/sizing summary using <dl> — denser than
             KV tables and pairs cleanly in two columns. */
          .print-cluster-summary {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.8em;
            margin: 0 0 0.6em 0;
            page-break-inside: avoid;
          }
          .print-cluster-col-h {
            font-family: 'IBM Plex Mono', monospace;
            font-size: 8pt; color: #64748b;
            text-transform: uppercase; letter-spacing: 0.06em;
            margin-bottom: 0.2em;
            border-bottom: 1px solid #e2e8f0; padding-bottom: 0.15em;
          }
          .print-dl {
            display: grid;
            grid-template-columns: max-content 1fr;
            column-gap: 0.6em; row-gap: 0.15em;
            margin: 0; font-size: 9pt;
          }
          .print-dl dt {
            color: #64748b; font-size: 8pt; font-weight: 500;
            font-family: 'IBM Plex Mono', monospace;
            text-transform: uppercase; letter-spacing: 0.04em;
            white-space: nowrap; padding-top: 0.1em;
          }
          .print-dl dd {
            margin: 0; color: #0f172a;
            font-family: 'IBM Plex Mono', monospace; font-size: 9pt;
          }

          /* Plan 9 — single-line domain chip row replaces the prior 3-row
             KV table. Each chip shows label + value inline. */
          .print-chip-row {
            display: flex; flex-wrap: wrap; gap: 0.4em;
            margin: 0.3em 0 0.6em 0;
            page-break-inside: avoid;
          }
          .print-chip {
            display: inline-flex; align-items: baseline;
            padding: 0.25em 0.7em;
            background: linear-gradient(135deg, #eff6ff 0%, #f0f9ff 100%) !important;
            border: 1px solid #bfdbfe; border-radius: 12px;
            font-family: 'IBM Plex Mono', monospace; font-size: 9pt;
            color: #0f172a;
          }
          .print-chip-k {
            font-size: 7.5pt; font-weight: 600;
            color: #1e40af;
            text-transform: uppercase; letter-spacing: 0.06em;
            margin-right: 0.4em;
          }

          /* Plan 9 — side-by-side vDS table + NIC topology SVG. Both
             columns share the same vertical block so the page-break
             logic treats them as a unit. */
          .print-network-row {
            display: grid;
            grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
            gap: 0.8em;
            align-items: start;
            page-break-inside: avoid;
          }
          .print-network-col { min-width: 0; }
          .print-network-col-diagram svg {
            max-height: 3.2in;
          }
          .print-cover-footer { margin-top: auto; padding-bottom: 0.3in; }
          .print-cover-stats {
            font-family: 'IBM Plex Mono', monospace; font-size: 9pt;
            color: #94a3b8; text-align: center;
          }

          /* Section headings — Plan 9 polish: colored bar accent on h2,
             type-coded domain h3 (mgmt = blue, workload = emerald), and
             a slate-tinted cluster h3. */
          .print-h2 {
            font-size: 18pt; font-weight: 700; color: #0f172a;
            margin: 0 0 0.5em 0;
            padding: 0.35em 0.6em 0.3em 0.7em;
            background: linear-gradient(90deg, #dbeafe 0%, #eff6ff 80%, #fff 100%) !important;
            border-left: 5px solid #2563eb;
            border-bottom: 2px solid #1e3a8a;
            border-radius: 2px;
            page-break-after: avoid;
          }
          .print-h3 {
            font-size: 13pt; font-weight: 600; color: #1e293b;
            margin: 1em 0 0.5em 0;
            padding: 0.25em 0.5em;
            background: #f1f5f9 !important;
            border-left: 3px solid #64748b;
            border-radius: 2px;
            page-break-after: avoid;
          }
          /* Mgmt vs Workload domain h3 color-coding via leading marker
             character. The actual h3 string starts with "▸ Management
             Domain" or "▸ Workload Domain" / "◆ Mgmt cluster" / "◆
             Workload cluster", so we use [class*="..."] is brittle;
             instead we use type-coded variants applied below. */
          .print-h3-mgmt {
            background: linear-gradient(90deg, #dbeafe 0%, #eff6ff 70%, #fff 100%) !important;
            border-left-color: #2563eb;
            color: #0c4a6e;
          }
          .print-h3-workload {
            background: linear-gradient(90deg, #d1fae5 0%, #ecfdf5 70%, #fff 100%) !important;
            border-left-color: #059669;
            color: #064e3b;
          }
          .print-h3-cluster-mgmt {
            background: linear-gradient(90deg, #e0e7ff 0%, #eef2ff 70%, #fff 100%) !important;
            border-left-color: #4f46e5;
            color: #312e81;
          }
          .print-h3-cluster-workload {
            background: linear-gradient(90deg, #ccfbf1 0%, #f0fdfa 70%, #fff 100%) !important;
            border-left-color: #0d9488;
            color: #134e4a;
          }
          .print-h4 {
            font-size: 10.5pt; font-weight: 600; color: #1e40af;
            margin: 0.8em 0 0.3em 0; page-break-after: avoid;
            text-transform: uppercase; letter-spacing: 0.05em;
            border-bottom: 1px solid #dbeafe;
            padding-bottom: 0.15em;
          }

          /* TOC. */
          .print-toc-list {
            font-family: 'IBM Plex Mono', monospace; font-size: 11pt;
            list-style: none; padding: 0; margin: 1em 0;
          }
          .print-toc-list li {
            padding: 0.4em 0; border-bottom: 1px dotted #cbd5e1;
            color: #1e293b;
          }

          /* Tables. */
          .print-table, .print-kv-table {
            width: 100%; border-collapse: collapse;
            font-size: 9pt; margin: 0.4em 0 1em 0;
            page-break-inside: auto;
          }
          .print-table thead { display: table-header-group; }
          .print-table tr { page-break-inside: avoid; page-break-after: auto; }
          .print-table th, .print-table td {
            text-align: left; padding: 0.3em 0.6em;
            border-bottom: 1px solid #e2e8f0;
            font-family: 'IBM Plex Mono', monospace; vertical-align: top;
          }
          .print-table th {
            background: linear-gradient(180deg, #dbeafe 0%, #eff6ff 100%) !important;
            color: #1e3a8a;
            font-weight: 600; font-size: 8pt;
            text-transform: uppercase; letter-spacing: 0.05em;
            border-bottom: 1.5px solid #93c5fd;
          }
          .print-table tfoot td {
            background: #eff6ff !important; font-weight: 600;
            border-top: 1.5px solid #93c5fd;
            color: #1e3a8a;
          }
          .print-kv-table th {
            text-align: left; padding: 0.3em 1em 0.3em 0;
            color: #64748b; font-weight: 500; font-size: 8.5pt;
            text-transform: uppercase; letter-spacing: 0.05em;
            white-space: nowrap; vertical-align: top; width: 1%;
          }
          .print-kv-table td {
            padding: 0.3em 0; color: #0f172a;
            font-family: 'IBM Plex Mono', monospace; font-size: 9pt;
          }
          .print-ip-table th, .print-ip-table td { padding: 0.2em 0.4em; }

          /* Domain / cluster blocks. Page-break-inside: auto so long
             clusters can split across pages cleanly with their tables
             repeating headers. Smaller sub-blocks try to stay together. */
          .print-domain { margin-top: 1.2em; page-break-inside: auto; }
          .print-cluster {
            margin-top: 1em;
            padding-left: 0.7em;
            border-left: 3px solid #c7d2fe;
            page-break-inside: auto;
          }
          .print-stack-block { margin-top: 0.6em; page-break-inside: avoid; }
          /* Cluster header + hardware + sizing should stick together — these
             are the "what the cluster is" identity. Appliance tables, IP
             plans, NIC diagrams can flow naturally afterwards. */
          .print-cluster-identity { page-break-inside: avoid; }

          /* Empty placeholders. */
          .print-empty {
            font-style: italic; color: #94a3b8;
            font-size: 9pt; margin: 0.5em 0;
          }

          /* Badges (Initial, Brownfield, etc.). */
          .print-badge {
            display: inline-block; margin-left: 0.5em;
            padding: 0.1em 0.5em; font-size: 8pt;
            background: #f1f5f9; color: #334155;
            border: 1px solid #cbd5e1; border-radius: 3px;
            font-family: 'IBM Plex Mono', monospace;
            text-transform: uppercase; letter-spacing: 0.05em;
            font-weight: 500;
          }
          .print-badge-amber {
            background: #fef3c7; color: #92400e; border-color: #fbbf24;
          }

          /* Failover verdict colors. */
          .print-verdict-green { color: #166534; font-weight: 600; }
          .print-verdict-yellow { color: #b45309; font-weight: 600; }
          .print-verdict-red { color: #b91c1c; font-weight: 700; }

          /* Validation section severity colors. */
          .print-issue-critical th { background: #fee2e2 !important; color: #991b1b !important; }
          .print-issue-error th { background: #fee2e2 !important; color: #991b1b !important; }
          .print-issue-warn th { background: #fef3c7 !important; color: #92400e !important; }
          .print-issue-info th { background: #dbeafe !important; color: #1e40af !important; }

          /* Force light backgrounds — Tailwind dark utility classes
             that occasionally creep into render output get overridden. */
          .bg-slate-50, .bg-slate-100, .bg-slate-800, .bg-slate-900,
          .bg-rose-50, .bg-amber-50, .bg-emerald-50, .bg-blue-50, .bg-sky-50,
          .bg-violet-50 { background: #fff !important; }

          /* SVG sizing for print: fit page width while preserving aspect
             ratio. The viewBox attribute on each <svg> defines the
             intrinsic coordinates; CSS scales it to fit the page. Without
             these rules, large SVGs can clip or overflow the printable
             area. */
          .print-svg-container {
            width: 100%;
            page-break-inside: avoid;
            margin: 0.4em 0 1em 0;
          }
          .print-svg {
            display: block;
            width: 100%;
            height: auto;
            max-height: 8.5in;
          }
          /* Plan 9 — fleet-wide and per-site SVGs on landscape topology
             pages. Landscape A4 printable area ≈ 10.7in × 7.27in (after
             margins), so the SVG can fill most of it while preserving
             aspect ratio. */
          .print-landscape .print-svg,
          .print-svg-fleet,
          .print-svg-site {
            max-height: 6.2in;
            max-width: 100%;
          }
          /* Force landscape sections to a single page — no orphan SVG. */
          .print-landscape {
            page-break-inside: avoid;
            page-break-after: always;
          }

          /* Per-cluster diagrams (NicDiagram, T0Diagram) are also inline
             SVGs. Their parent containers shouldn't impose horizontal
             scrolling for print. */
          .print-diagram svg {
            display: block;
            width: 100%;
            height: auto;
            max-height: 5in;
          }
          /* Strip overflow + background containers around per-cluster
             diagrams. NicDiagram/T0Diagram are wrapped by editor styles
             that don't make sense in the document. */
          .print-diagram > div {
            background: transparent !important;
            border: none !important;
            padding: 0 !important;
            overflow: visible !important;
          }

          /* Plan 9 — section intro paragraphs (italic-free, distinct from
             the .print-empty fallback which is meant for "(no data)" rows). */
          .print-section-intro {
            font-size: 10pt;
            color: #475569;
            margin: 0.3em 0 0.8em 0;
            line-height: 1.4;
          }

          /* Plan 9 — physical topology per-site SVGs render at full page
             width with a generous max height, and have a soft border to
             frame each site card distinctly. */
          .print-physical-site { margin-top: 1em; }
          .print-svg-site {
            display: block;
            width: 100%;
            height: auto;
            max-height: 7.5in;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            background: #f8fafc !important;
          }
          .print-h3-sub {
            font-size: 10pt;
            font-weight: 400;
            color: #94a3b8;
            margin-left: 0.5em;
          }

          /* Callouts (e.g. "Stretched relationships" summary). Compact
             block with a colored left border. */
          .print-callout {
            border-left: 3px solid #2563eb;
            background: #f1f5f9 !important;
            padding: 0.4em 0.8em;
            margin: 0.6em 0;
            page-break-inside: avoid;
          }
          .print-callout .print-h4 {
            margin-top: 0;
            color: #1e40af;
          }
          .print-list {
            margin: 0.3em 0;
            padding-left: 1.2em;
            font-family: 'IBM Plex Mono', monospace;
            font-size: 9pt;
            color: #1e293b;
          }
          .print-list li { padding: 0.1em 0; }

          /* Plan 9 — alternate-row backgrounds on long tables for
             readability. Affects all .print-table tbody rows. */
          .print-table tbody tr:nth-child(even) {
            background: #f8fafc !important;
          }

          /* Tighten table padding for print density. */
          .print-table th, .print-table td { padding: 0.25em 0.5em; }
          .print-kv-table th { padding: 0.25em 0.8em 0.25em 0; }
          .print-kv-table td { padding: 0.25em 0; }
          .print-ip-table th, .print-ip-table td { padding: 0.18em 0.35em; font-size: 8.5pt; }
        }
      `}</style>

      <header className="max-w-[1800px] mx-auto mb-8">
        <div className="flex items-baseline justify-between gap-4 mb-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.3em] text-blue-600 font-mono">
            VMware Cloud Foundation {fleet.vcfVersion || DEFAULT_VCF_VERSION_LEGACY} · Design Studio · v9
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-[10px] uppercase tracking-wider font-mono text-slate-600 border border-slate-200 hover:border-blue-400 hover:text-blue-600 rounded px-3 py-1.5"
              title="Replace the current fleet with the imported config."
            >
              Import JSON
            </button>
            <button
              onClick={() => expandInputRef.current?.click()}
              className="text-[10px] uppercase tracking-wider font-mono text-slate-600 border border-slate-200 hover:border-emerald-400 hover:text-emerald-600 rounded px-3 py-1.5"
              title="VCF-PATH-002: append the imported config's first instance to this fleet as an expand-fleet addition. Per-fleet appliances (VCF Operations, Automation, Fleet Mgr, Logs, Networks Platform) are stripped from the imported instance."
            >
              Import as new instance
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={importConfig}
              className="hidden"
            />
            <input
              ref={expandInputRef}
              type="file"
              accept="application/json"
              onChange={importAsNewInstance}
              className="hidden"
            />
            <button
              onClick={exportConfig}
              className="text-[10px] uppercase tracking-wider font-mono text-slate-600 border border-slate-200 hover:border-blue-400 hover:text-blue-600 rounded px-3 py-1.5"
            >
              Export JSON
            </button>
            <button
              onClick={exportInstallerJson}
              className="text-[10px] uppercase tracking-wider font-mono text-slate-600 border border-slate-200 hover:border-violet-400 hover:text-violet-600 rounded px-3 py-1.5"
              title="Export VCF Installer bringup-spec.json with network configuration, host IPs, and edge specs."
            >
              Export Installer JSON
            </button>
            <button
              onClick={exportWorkbookCsv}
              className="text-[10px] uppercase tracking-wider font-mono text-slate-600 border border-slate-200 hover:border-teal-400 hover:text-teal-600 rounded px-3 py-1.5"
              title="Export Planning Workbook CSV with fleet services, network config, IP plan, and BGP settings."
            >
              Export Workbook CSV
            </button>
            <button
              onClick={exportWorkbookCellMap}
              className="text-[10px] uppercase tracking-wider font-mono text-slate-600 border border-slate-200 hover:border-emerald-400 hover:text-emerald-600 rounded px-3 py-1.5"
              title={`Export a cell-addressable CSV targeting the official VCF ${workbookVersionForFleet(fleet)} Planning & Preparation Workbook. Each row is (workbookVersion, sheet, cell, label, value). Stamp it into the pristine workbook via scripts/stamp-workbook.py — see README.`}
            >
              Export Workbook {workbookVersionForFleet(fleet)} Cell Map
            </button>
            <button
              onClick={() => window.print()}
              className="text-[10px] uppercase tracking-wider font-mono text-slate-600 border border-slate-200 hover:border-amber-400 hover:text-amber-600 rounded px-3 py-1.5"
              title="Open the browser print dialog with a multi-page PDF-friendly rendering of the fleet. Use 'Save as PDF' in the print dialog to deliver the file."
            >
              Print / Save as PDF
            </button>
            <button
              onClick={resetAll}
              className="text-[10px] uppercase tracking-wider font-mono text-slate-400 border border-slate-200 hover:border-rose-400 hover:text-rose-600 rounded px-3 py-1.5"
            >
              Reset
            </button>
          </div>
        </div>
        <h1 className="font-serif text-5xl lg:text-6xl text-slate-900 leading-none mb-3">
          VCF <span className="italic text-blue-600">Design Studio</span>
        </h1>
        <input
          value={fleet.name}
          onChange={(e) => setFleet({ ...fleet, name: e.target.value })}
          className="bg-transparent text-xl text-slate-600 italic font-serif border-none focus:outline-none focus:bg-slate-50 rounded px-1 mb-3"
        />
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono">
            VCF Version
          </label>
          <select
            value={fleet.vcfVersion ?? DEFAULT_VCF_VERSION_LEGACY}
            onChange={(e) => {
              const target = e.target.value;
              const current = fleet.vcfVersion || DEFAULT_VCF_VERSION_LEGACY;
              if (target === current) return;
              if (target === "9.1") {
                if (!window.confirm(
                  "Switch to VCF 9.1?\n\n" +
                  "• Adds VCFMS Control + Worker nodes to the initial instance's management stack\n" +
                  "• vCenter storage profile values change per the 9.1 P&P Workbook\n" +
                  "• Sizing math re-runs with 9.1 appliance values\n\n" +
                  "Continue?"
                )) return;
                setFleet(migrate9_0To9_1({ ...fleet, vcfVersion: "9.0" }));
              } else if (target === "9.0") {
                // Count VCFMS entries that would be removed across all stacks.
                let vcfmsCount = 0;
                for (const inst of fleet.instances || []) {
                  for (const dom of inst.domains || []) {
                    for (const clu of dom.clusters || []) {
                      for (const e of clu.infraStack || []) {
                        if (e.id === "vcfmsControl" || e.id === "vcfmsWorker") vcfmsCount++;
                      }
                    }
                  }
                }
                if (!window.confirm(
                  "Downgrade to VCF 9.0?\n\n" +
                  `• Removes ${vcfmsCount} VCFMS appliance entr${vcfmsCount === 1 ? "y" : "ies"} from your management stacks\n` +
                  "• Any custom sizing on VCFMS nodes is LOST and will reset to defaults if you switch back to 9.1\n" +
                  "• vCenter storage profile values revert to 9.0 P&P Workbook values\n\n" +
                  "Continue?"
                )) return;
                setFleet(migrate9_1To9_0({ ...fleet, vcfVersion: "9.1" }));
              }
            }}
            className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1 text-slate-700 focus:outline-none focus:border-blue-400"
            title="Plan 12 — selects the VCF version this fleet targets. 9.0 and 9.1 have different vCenter storage values; 9.1 also adds the VCFMS (VCF Management Service) Kubernetes control plane. Switching reshapes the mgmt stack on the initial instance."
          >
            {SUPPORTED_VCF_VERSIONS.map((v) => (
              <option key={v} value={v}>VCF {v}</option>
            ))}
          </select>
          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono ml-4">
            Deployment Pathway
          </label>
          <select
            value={fleet.deploymentPathway || "greenfield"}
            onChange={(e) => setFleet({ ...fleet, deploymentPathway: e.target.value })}
            className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1 text-slate-700 focus:outline-none focus:border-blue-400"
            title="VCF-PATH-001..004: determines how this fleet was built and drives per-fleet appliance placement. Changes here are informational — they don't reshape existing instance stacks."
          >
            {Object.entries(DEPLOYMENT_PATHWAYS).map(([key, def]) => (
              <option key={key} value={key}>{def.label} ({def.ruleId})</option>
            ))}
          </select>
          <span className="text-[11px] text-slate-500 italic max-w-xl">
            {DEPLOYMENT_PATHWAYS[fleet.deploymentPathway || "greenfield"]?.description}
          </span>
          <label
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono cursor-pointer select-none ml-4"
            title="VCF-INV-021: when enabled, nsxGlobalMgr is expected on the initial instance (active cluster) plus a second instance (standby cluster). Federation requires fleet.instances.length >= 2 (VCF-INV-051)."
          >
            <input
              type="checkbox"
              checked={!!fleet.federationEnabled}
              onChange={(e) => setFleet({ ...fleet, federationEnabled: e.target.checked })}
              className="accent-blue-600"
            />
            NSX Federation
          </label>
        </div>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono">
            SSO Model
          </label>
          <select
            value={fleet.ssoMode || "embedded"}
            onChange={(e) => setFleet({ ...fleet, ssoMode: e.target.value })}
            className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1 text-slate-700 focus:outline-none focus:border-blue-400"
            title="VCF-APP-030 / VCF-SSO-001..003: selects the identity broker topology. Changes here are informational for the design — the studio does not yet auto-reshape identityBroker stack entries."
          >
            {Object.entries(SSO_MODES).map(([key, def]) => (
              <option key={key} value={key}>{def.label} ({def.ruleId})</option>
            ))}
          </select>
          <span className="text-[11px] text-slate-500 italic max-w-xl">
            {SSO_MODES[fleet.ssoMode || "embedded"]?.description}
          </span>
          {(() => {
            const stats = ssoInstancesPerBroker(fleet);
            if (!stats.overLimit) return null;
            return (
              <span
                className="text-[10px] uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-300 rounded px-2 py-0.5 font-mono"
                title={`VCF-INV-031: soft recommendation is ≤ ${SSO_INSTANCES_PER_BROKER_LIMIT} instances per broker. Current fleet has ${stats.instances} instances across ${stats.brokers} broker(s) (${stats.perBroker.toFixed(1)} per broker). Consider multi-broker segmentation (VCF-SSO-003).`}
              >
                ⚠ over-limit
              </span>
            );
          })()}
        </div>
        <p className="text-slate-500 max-w-3xl text-sm leading-relaxed">
          Design and size multi-site VCF 9 environments. Build a hierarchy of sites,
          VCF instances, domains, and clusters — each cluster gets its own host spec
          and sizing math. Switch to the Topology tab for an auto-generated SVG
          diagram you can drop into design documents.
        </p>

        {/* View tabs */}
        <div className="flex gap-1 mt-5 border-b border-slate-200">
          <TabButton active={view === "editor"} onClick={() => setView("editor")}>
            Editor
          </TabButton>
          <TabButton active={view === "topology"} onClick={() => setView("topology")}>
            Topology Diagram
          </TabButton>
          <TabButton active={view === "persite"} onClick={() => setView("persite")}>
            Per-Site View
          </TabButton>
          <TabButton active={view === "network"} onClick={() => setView("network")}>
            Network
          </TabButton>
        </div>
      </header>

      {autoImportedNotice && (
        <div className="max-w-[1800px] mx-auto mb-4 border border-amber-300 bg-amber-50 rounded p-4 flex items-start gap-3">
          <span className="text-amber-700 text-lg leading-none mt-0.5">⌂</span>
          <div className="flex-1">
            <div className="text-[11px] uppercase tracking-wider text-amber-800 font-mono font-semibold mb-1">
              VCF-PATH-004 — {autoImportedNotice.domains.length} workload domain{autoImportedNotice.domains.length === 1 ? "" : "s"} auto-flagged as imported (brownfield)
            </div>
            <p className="text-[12px] text-amber-900 font-mono leading-relaxed mb-2">
              The imported config placed appliance VMs on workload-domain hosts, which is only legal for
              brownfield (imported) workload domains in VCF 9. Migration preserved the placement by marking
              {" "}
              <strong>{autoImportedNotice.domains.map((d) => d.name).join(", ")}</strong>
              {" "}
              as Imported. Review each domain's <em>Imported (brownfield)</em> toggle and clear it
              if the placement should instead be moved onto a management-domain cluster (VCF-INV-003).
            </p>
            <button
              onClick={() => setAutoImportedNotice(null)}
              className="text-[10px] uppercase tracking-wider text-amber-800 font-mono bg-white border border-amber-300 hover:bg-amber-100 rounded px-2 py-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main className="max-w-[1800px] mx-auto">
        {view === "editor" ? (
          <>
            <SitesPanel fleet={fleet} onChange={setFleet} />
            <InstancesPanel fleet={fleet} fleetResult={fleetResult} onChange={setFleet} />
            <FleetSummary fleet={fleet} fleetResult={fleetResult} onChange={setFleet} />
          </>
        ) : view === "topology" ? (
          <>
            <TopologyView fleet={fleet} fleetResult={fleetResult} setFleet={setFleet} />
            <div className="mt-5">
              <FleetSummary fleet={fleet} fleetResult={fleetResult} onChange={setFleet} />
            </div>
          </>
        ) : view === "persite" ? (
          <>
            <PerSiteView fleet={fleet} fleetResult={fleetResult} />
            <div className="mt-5">
              <FleetSummary fleet={fleet} fleetResult={fleetResult} onChange={setFleet} />
            </div>
          </>
        ) : view === "network" ? (
          <>
            <NetworkView fleet={fleet} fleetResult={fleetResult} />
            <div className="mt-5">
              <FleetSummary fleet={fleet} fleetResult={fleetResult} onChange={setFleet} />
            </div>
          </>
        ) : null}

        <div className="border-t border-slate-200 mt-10 pt-6 pb-4">
          <div className="mb-5">
            <h3 className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-mono font-semibold mb-3">
              Official Broadcom Resources
            </h3>
            {(() => {
              // Plan 12 — version-template the Broadcom doc URLs.
              // Path segment "9-0" / "9-1" follows Broadcom's techdocs convention.
              const v = fleet.vcfVersion || DEFAULT_VCF_VERSION_LEGACY;
              const vDashed = v.replace(".", "-");
              return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
              <a
                href={`https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/${vDashed}/planning-and-preparation.html`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">VCF {v} Planning &amp; Preparation Workbook</span>
              </a>
              <a
                href={`https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/${vDashed}/design.html`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">VCF {v} Design Guide</span>
              </a>
              <a
                href={`https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/${vDashed}/overview-of-vmware-cloud-foundation-9.html`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">VCF {v} Overview</span>
              </a>
              <a
                href={`https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/${vDashed}/release-notes.html`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">VCF {v} Release Notes</span>
              </a>
              <a
                href="https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/vsphere-supervisor-installation-and-configuration.html"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">vSphere Supervisor (VKS) Installation</span>
              </a>
              <a
                href="https://configmax.broadcom.com/"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">VMware Configuration Maximums</span>
              </a>
              <a
                href="https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/building-your-private-cloud-infrastructure/working-with-workload-domains.html"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">Working with Workload Domains</span>
              </a>
              <a
                href="https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/design-library.html"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">VCF Validated Solutions Library</span>
              </a>
              <a
                href="https://knowledge.broadcom.com/external/search?searchText=VMware%20Cloud%20Foundation%209"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">Broadcom Knowledge Base (VCF 9)</span>
              </a>
            </div>
              );
            })()}
          </div>

          <footer className="text-center text-[10px] text-slate-400 font-mono uppercase tracking-[0.16em] pt-4 border-t border-slate-200 leading-relaxed">
            VCF Design Studio v9 · Planning aid only · Appliance data sourced from the official Broadcom VCF {fleet.vcfVersion || DEFAULT_VCF_VERSION_LEGACY}
            Planning &amp; Preparation Workbook and techdocs.broadcom.com · Validate against current VMware documentation before procurement
            <br />
            Built by William de Marigny
          </footer>
        </div>
      </main>
      {/* Plan 8b — PrintView. Always mounted so it shares the existing
          memoized fleetResult; CSS hides it in screen mode and reveals it
          (while hiding editor chrome) in print mode. */}
      <PrintView fleet={fleet} fleetResult={fleetResult} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NETWORK VIEW — visualizes NIC profiles, VLANs, T0 topology, and IP assignments
// ─────────────────────────────────────────────────────────────────────────────
const NET_COLORS = {
  mgmt: { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" },
  vmotion: { bg: "#ede9fe", border: "#8b5cf6", text: "#5b21b6" },
  vsan: { bg: "#d1fae5", border: "#10b981", text: "#065f46" },
  hostTep: { bg: "#fef3c7", border: "#f59e0b", text: "#92400e" },
  edgeTep: { bg: "#fee2e2", border: "#ef4444", text: "#991b1b" },
  uplink: { bg: "#f3f4f6", border: "#6b7280", text: "#374151" },
};

function NicDiagram({ cluster, label }) {
  const profileId = cluster.networks ? cluster.networks.nicProfileId : "4-nic";
  const profile = NIC_PROFILES[profileId];
  if (!profile) return <p className="text-xs text-slate-400 font-mono">Unknown NIC profile: {profileId}</p>;

  const nicCount = profile.nicCount;
  const vdsList = profile.vds;
  const portgroups = profile.portgroups;

  // Layout constants
  const nicW = 90, nicH = 26, nicGap = 6;
  const vdsW = 160, pgW = 110, pgH = 26, pgGap = 4;
  const leftX = 20, midX = 140, rightX = 360;
  const vdsGap = 24;

  // Map portgroup names to traffic types
  const pgToTypes = {};
  Object.entries(portgroups).forEach(([type, vdsName]) => {
    if (!pgToTypes[vdsName]) pgToTypes[vdsName] = [];
    pgToTypes[vdsName].push(type);
  });

  // Lay out vDS boxes vertically, one per vDS in the profile
  // Each vDS box has a fixed height, NIC slots are distributed evenly within it
  const vdsBoxes = vdsList.map((vds) => ({
    ...vds,
    x: midX,
    y: 0, // will compute after we know heights
    w: vdsW,
    h: vds.uplinks.length * (nicH + nicGap) + 20, // padding top/bottom
  }));

  // Assign Y positions with gaps between boxes
  let vy = 20;
  vdsBoxes.forEach((vds) => {
    vds.y = vy;
    vy += vds.h + vdsGap;
  });

  // Place each NIC aligned with its slot inside the parent vDS box
  const nics = profile.uplinks.map((name) => {
    const vds = vdsBoxes.find(v => v.uplinks.includes(name));
    if (!vds) return { name, x: leftX, y: 0, w: nicW, h: nicH };
    const idx = vds.uplinks.indexOf(name);
    const y = vds.y + 10 + idx * (nicH + nicGap);
    return { name, x: leftX, y, w: nicW, h: nicH };
  });

  // Position traffic type boxes centered within their parent vDS
  const pgBoxes = [];
  vdsBoxes.forEach(vds => {
    const types = pgToTypes[vds.name] || [];
    const totalPgH = types.length * (pgH + pgGap) - pgGap;
    const startY = vds.y + (vds.h - totalPgH) / 2;
    types.forEach((type, ti) => {
      pgBoxes.push({
        type,
        vdsName: vds.name,
        x: rightX,
        y: startY + ti * (pgH + pgGap),
        w: pgW,
        h: pgH,
      });
    });
  });

  const bottomY = Math.max(
    nics.length > 0 ? nics[nics.length - 1].y + nicH : 0,
    vdsBoxes.length > 0 ? vdsBoxes[vdsBoxes.length - 1].y + vdsBoxes[vdsBoxes.length - 1].h : 0,
    pgBoxes.length > 0 ? pgBoxes[pgBoxes.length - 1].y + pgH : 0
  );
  const svgH = bottomY + 30;

  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono mb-2">{label} — {profileId} ({nicCount} NICs)</div>
      <svg
        width={rightX + pgW + 30}
        height={svgH}
        viewBox={`0 0 ${rightX + pgW + 30} ${svgH}`}
        preserveAspectRatio="xMidYMid meet"
        className="border border-slate-100 rounded bg-slate-50"
      >
        {/* NICs */}
        {nics.map(nic => (
          <g key={nic.name}>
            <rect x={nic.x} y={nic.y} width={nic.w} height={nic.h} rx="4" fill="#f1f5f9" stroke="#64748b" strokeWidth="1" />
            <text x={nic.x + nic.w / 2} y={nic.y + nic.h / 2 + 4} textAnchor="middle" fill="#334155" style={{ fontSize: "10px", fontFamily: "IBM Plex Mono, monospace" }}>{nic.name}</text>
          </g>
        ))}

        {/* vDS boxes + NIC→vDS connectors */}
        {vdsBoxes.map((vds, vi) => (
          <g key={vi}>
            <rect x={vds.x} y={vds.y} width={vds.w} height={vds.h} rx="6" fill="#f0f9ff" stroke="#0284c7" strokeWidth="1.5" strokeDasharray="4 2" />
            <text x={vds.x + 8} y={vds.y + 14} fill="#0c4a6e" style={{ fontSize: "9px", fontFamily: "IBM Plex Mono, monospace" }}>{vds.name}</text>
            <text x={vds.x + vds.w - 8} y={vds.y + 14} textAnchor="end" fill="#64748b" style={{ fontSize: "8px", fontFamily: "IBM Plex Mono, monospace" }}>MTU {vds.mtu}</text>
            {/* Connect each NIC assigned to this vDS at the NIC's Y level */}
            {nics.filter(n => vds.uplinks.includes(n.name)).map(nic => (
              <line key={nic.name}
                x1={nic.x + nic.w} y1={nic.y + nic.h / 2}
                x2={vds.x} y2={nic.y + nic.h / 2}
                stroke="#94a3b8" strokeWidth="1.2" />
            ))}
          </g>
        ))}

        {/* Traffic type boxes + vDS→traffic connectors */}
        {pgBoxes.map((pg, pi) => {
          const color = NET_COLORS[pg.type] || NET_COLORS.uplink;
          const vds = vdsBoxes.find(v => v.name === pg.vdsName);
          const connY = pg.y + pg.h / 2;
          return (
            <g key={pi}>
              <rect x={pg.x} y={pg.y} width={pg.w} height={pg.h} rx="4" fill={color.bg} stroke={color.border} strokeWidth="1.5" />
              <text x={pg.x + pg.w / 2} y={pg.y + pg.h / 2 + 4} textAnchor="middle" fill={color.text} style={{ fontSize: "10px", fontFamily: "IBM Plex Mono, monospace" }}>{pg.type}</text>
              {/* Horizontal connector from vDS right edge to traffic box */}
              {vds && <line
                x1={vds.x + vds.w} y1={connY}
                x2={pg.x} y2={connY}
                stroke={color.border} strokeWidth="1.2" opacity="0.7" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function VlanSubnetMap({ fleet }) {
  const rows = [];
  (fleet.instances || []).forEach(function(inst) {
    (inst.domains || []).forEach(function(dom) {
      (dom.clusters || []).forEach(function(cl) {
        const nets = cl.networks;
        if (!nets) return;
        rows.push({ name: cl.name, nets });
      });
    });
  });

  if (rows.length === 0) return <p className="text-sm text-slate-400 font-mono">No cluster networks configured.</p>;

  const vlanCounts = {};
  rows.forEach(r => {
    ["mgmt", "vmotion", "vsan", "hostTep", "edgeTep"].forEach(key => {
      const v = r.nets[key] && r.nets[key].vlan;
      if (v != null) {
        const k = key + ":" + v;
        vlanCounts[k] = (vlanCounts[k] || 0) + 1;
      }
    });
  });

  const netTypes = [
    { key: "mgmt", label: "Mgmt" },
    { key: "vmotion", label: "vMotion" },
    { key: "vsan", label: "vSAN" },
    { key: "hostTep", label: "Host TEP" },
    { key: "edgeTep", label: "Edge TEP" },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="text-[10px] font-mono w-full border-collapse">
        <thead>
          <tr>
            <th className="text-left px-2 py-1.5 border-b-2 border-slate-300 text-slate-500 uppercase tracking-wider">Cluster</th>
            {netTypes.map(nt => {
              const color = NET_COLORS[nt.key];
              return (
                <th key={nt.key} className="text-left px-2 py-1.5 border-b-2 uppercase tracking-wider" style={{ borderBottomColor: color.border, color: color.text }}>
                  {nt.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-slate-50"}>
              <td className="px-2 py-1.5 border-b border-slate-100 text-slate-700 font-semibold">{row.name}</td>
              {netTypes.map(nt => {
                const net = row.nets[nt.key];
                const vlan = net && net.vlan;
                const subnet = net && net.subnet;
                const isDuplicate = vlan != null && vlanCounts[nt.key + ":" + vlan] > 1;
                const color = NET_COLORS[nt.key];
                return (
                  <td key={nt.key} className="px-2 py-1.5 border-b border-slate-100" style={{ backgroundColor: isDuplicate ? "#fef2f2" : undefined }}>
                    {vlan != null ? (
                      <div>
                        <span style={{ color: color.text, fontWeight: 600 }}>VLAN {vlan}</span>
                        {isDuplicate && <span className="text-red-600 ml-1" title="Duplicate VLAN">⚠</span>}
                        {subnet && <div className="text-slate-400">{subnet}</div>}
                      </div>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function T0Diagram({ cluster, label }) {
  const t0s = cluster.t0Gateways || [];
  if (t0s.length === 0) return null;

  const svgW = 500;
  let curY = 20;

  const elements = [];

  t0s.forEach(function(t0, ti) {
    const startY = curY;
    const edgeNodes = t0.edgeNodeKeys || [];
    const peers = t0.bgpPeers || [];

    const peerBoxW = 110, peerBoxH = 40, peerGap = 12;
    const peersStartX = (svgW - (peers.length * (peerBoxW + peerGap) - peerGap)) / 2;
    peers.forEach(function(peer, pi) {
      const px = peersStartX + pi * (peerBoxW + peerGap);
      elements.push(
        <g key={"peer-" + ti + "-" + pi}>
          <rect x={px} y={curY} width={peerBoxW} height={peerBoxH} rx="4" fill="#f3f4f6" stroke="#6b7280" strokeWidth="1" />
          <text x={px + peerBoxW/2} y={curY + 14} textAnchor="middle" fill="#374151" className="text-[9px] font-mono">
            {peer.name || "Peer " + (pi+1)}
          </text>
          <text x={px + peerBoxW/2} y={curY + 28} textAnchor="middle" fill="#6b7280" className="text-[8px] font-mono">
            ASN {peer.asn || "?"} • {peer.ip || "?.?.?.?"}
          </text>
        </g>
      );
    });
    if (peers.length > 0) curY += peerBoxH + 20;

    const t0BoxW = 200, t0BoxH = 50;
    const t0X = (svgW - t0BoxW) / 2;
    const modeColor = t0.haMode === "active-active" ? "#7c3aed" : "#0284c7";
    elements.push(
      <g key={"t0-" + ti}>
        <rect x={t0X} y={curY} width={t0BoxW} height={t0BoxH} rx="6" fill="#f0f9ff" stroke={modeColor} strokeWidth="2" />
        <text x={t0X + t0BoxW/2} y={curY + 18} textAnchor="middle" fill="#0c4a6e" className="text-[11px] font-mono" fontWeight="600">
          {t0.name}
        </text>
        <text x={t0X + t0BoxW/2} y={curY + 34} textAnchor="middle" fill={modeColor} className="text-[9px] font-mono">
          {t0.haMode} {t0.stateful ? "(stateful)" : ""} • ASN {t0.asnLocal || "—"}
        </text>
      </g>
    );

    peers.forEach(function(peer, pi) {
      const px = peersStartX + pi * (peerBoxW + peerGap) + peerBoxW / 2;
      elements.push(
        <line key={"peer-conn-" + ti + "-" + pi} x1={px} y1={startY + peerBoxH} x2={t0X + t0BoxW/2} y2={curY} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 2" />
      );
    });
    curY += t0BoxH + 20;

    const edgeBoxW = 100, edgeBoxH = 36, edgeGap = 12;
    const edgeStartX = (svgW - (edgeNodes.length * (edgeBoxW + edgeGap) - edgeGap)) / 2;
    edgeNodes.forEach(function(key, ei) {
      const ex = edgeStartX + ei * (edgeBoxW + edgeGap);
      elements.push(
        <g key={"edge-" + ti + "-" + ei}>
          <rect x={ex} y={curY} width={edgeBoxW} height={edgeBoxH} rx="4" fill="#fef3c7" stroke="#f59e0b" strokeWidth="1.5" />
          <text x={ex + edgeBoxW/2} y={curY + 14} textAnchor="middle" fill="#92400e" className="text-[9px] font-mono">Edge Node</text>
          <text x={ex + edgeBoxW/2} y={curY + 28} textAnchor="middle" fill="#92400e" className="text-[8px] font-mono">{key}</text>
          <line x1={t0X + t0BoxW/2} y1={curY - 20 + t0BoxH} x2={ex + edgeBoxW/2} y2={curY} stroke="#f59e0b" strokeWidth="1.5" />
        </g>
      );
    });
    if (edgeNodes.length > 0) curY += edgeBoxH + 20;
    curY += 10;
  });

  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono mb-2">{label}</div>
      <svg
        width={svgW}
        height={curY}
        viewBox={`0 0 ${svgW} ${curY}`}
        preserveAspectRatio="xMidYMid meet"
        className="border border-slate-100 rounded bg-slate-50"
      >
        {elements}
      </svg>
    </div>
  );
}

function IpGrid({ cluster, finalHosts, label }) {
  const ipPlan = allocateClusterIps(cluster, finalHosts);
  if (!ipPlan || ipPlan.hosts.length === 0) return null;

  const netTypes = [
    { key: "mgmtIp", label: "vmk0 (Mgmt)", color: NET_COLORS.mgmt },
    { key: "vmotionIp", label: "vmk1 (vMotion)", color: NET_COLORS.vmotion },
    { key: "vsanIp", label: "vmk2 (vSAN)", color: NET_COLORS.vsan },
    { key: "hostTepIps", label: "vmk10/11 (TEP)", color: NET_COLORS.hostTep },
  ];

  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono mb-2">{label} — {finalHosts} hosts</div>
      {ipPlan.warnings.length > 0 && (
        <div className="mb-2 space-y-1">
          {ipPlan.warnings.map((w, wi) => (
            <div key={wi} className={`text-[10px] font-mono px-2 py-1 rounded ${
              w.severity === "error" ? "bg-rose-50 text-rose-700 border border-rose-200" :
              w.severity === "warn" ? "bg-amber-50 text-amber-700 border border-amber-200" :
              "bg-sky-50 text-sky-700 border border-sky-200"
            }`}>
              [{w.ruleId}] {w.message}
            </div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="text-[10px] font-mono border-collapse w-full">
          <thead>
            <tr>
              <th className="px-2 py-1.5 border-b-2 border-slate-300 text-left text-slate-500">#</th>
              {netTypes.map(nt => (
                <th key={nt.key} className="px-2 py-1.5 border-b-2 text-left" style={{ borderBottomColor: nt.color.border, color: nt.color.text }}>
                  {nt.label}
                </th>
              ))}
              <th className="px-2 py-1.5 border-b-2 border-slate-300 text-left text-slate-500">Source</th>
            </tr>
          </thead>
          <tbody>
            {ipPlan.hosts.map(h => (
              <tr key={h.index} style={{ backgroundColor: h.source === "override" ? "#fffbeb" : undefined }}>
                <td className="px-2 py-1 border-b border-slate-100 text-slate-400">{h.index}</td>
                <td className="px-2 py-1 border-b border-slate-100" style={{ color: NET_COLORS.mgmt.text }}>{h.mgmtIp || "—"}</td>
                <td className="px-2 py-1 border-b border-slate-100" style={{ color: NET_COLORS.vmotion.text }}>{h.vmotionIp || "—"}</td>
                <td className="px-2 py-1 border-b border-slate-100" style={{ color: NET_COLORS.vsan.text }}>{h.vsanIp || "—"}</td>
                <td className="px-2 py-1 border-b border-slate-100" style={{ color: NET_COLORS.hostTep.text }}>{h.hostTepIps ? h.hostTepIps.join(", ") : "DHCP"}</td>
                <td className="px-2 py-1 border-b border-slate-100">{h.source === "override" ?
                  <span className="text-amber-600 font-semibold">override</span> :
                  <span className="text-slate-400">pool</span>
                }</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ipPlan.edgeNodes.length > 0 && (
        <div className="mt-3">
          <div className="text-[9px] uppercase tracking-wider text-slate-400 mb-1">Edge Node TEP Assignments</div>
          <table className="text-[10px] font-mono border-collapse w-full">
            <thead>
              <tr>
                <th className="px-2 py-1 border-b border-slate-200 text-left text-slate-500">Edge Key</th>
                <th className="px-2 py-1 border-b border-slate-200 text-left" style={{ color: NET_COLORS.edgeTep.text }}>Edge TEP IPs</th>
              </tr>
            </thead>
            <tbody>
              {ipPlan.edgeNodes.map((en, ei) => (
                <tr key={ei}>
                  <td className="px-2 py-1 border-b border-slate-100 text-slate-500">{en.edgeNodeKey}</td>
                  <td className="px-2 py-1 border-b border-slate-100" style={{ color: NET_COLORS.edgeTep.text }}>{en.edgeTepIps.filter(Boolean).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NetworkView({ fleet, fleetResult }) {
  const clusters = [];
  (fleet.instances || []).forEach(function(inst, instIdx) {
    (inst.domains || []).forEach(function(dom, domIdx) {
      (dom.clusters || []).forEach(function(cl, clIdx) {
        const ir = fleetResult.instanceResults[instIdx];
        const dr = ir && ir.domainResults[domIdx];
        const cr = dr && dr.clusterResults[clIdx];
        const finalHosts = cr ? cr.finalHosts : 0;
        clusters.push({ cluster: cl, finalHosts, path: inst.name + " / " + dom.name + " / " + cl.name });
      });
    });
  });

  return (
    <div className="space-y-8">
      {/* Section 1: Physical NIC Diagrams */}
      <div className="border border-slate-200 bg-white rounded-lg p-6">
        <h2 className="font-serif text-2xl text-slate-900 italic mb-4">Physical NIC Topology</h2>
        <div className="space-y-6">
          {clusters.map(({ cluster, path }) => (
            <NicDiagram key={cluster.id} cluster={cluster} label={path} />
          ))}
        </div>
      </div>

      {/* Section 2: VLAN/Subnet Map */}
      <div className="border border-slate-200 bg-white rounded-lg p-6">
        <h2 className="font-serif text-2xl text-slate-900 italic mb-4">VLAN &amp; Subnet Map</h2>
        <VlanSubnetMap fleet={fleet} />
      </div>

      {/* Section 3: NSX Edge/T0 Topology */}
      <div className="border border-slate-200 bg-white rounded-lg p-6">
        <h2 className="font-serif text-2xl text-slate-900 italic mb-4">NSX Edge / T0 Topology</h2>
        <div className="space-y-6">
          {clusters.filter(({ cluster }) => (cluster.t0Gateways || []).length > 0).map(({ cluster, path }) => (
            <T0Diagram key={cluster.id} cluster={cluster} label={path} />
          ))}
          {clusters.every(({ cluster }) => (cluster.t0Gateways || []).length === 0) && (
            <p className="text-sm text-slate-400 font-mono">No T0 gateways configured on any cluster.</p>
          )}
        </div>
      </div>

      {/* Section 4: Per-Host IP Grid */}
      <div className="border border-slate-200 bg-white rounded-lg p-6">
        <h2 className="font-serif text-2xl text-slate-900 italic mb-4">Per-Host IP Assignments</h2>
        <div className="space-y-6">
          {clusters.filter(({ cluster }) => cluster.networks && cluster.networks.mgmt && cluster.networks.mgmt.pool && cluster.networks.mgmt.pool.start).map(({ cluster, finalHosts, path }) => (
            <IpGrid key={cluster.id} cluster={cluster} finalHosts={finalHosts} label={path} />
          ))}
          {clusters.every(({ cluster }) => !cluster.networks || !cluster.networks.mgmt || !cluster.networks.mgmt.pool || !cluster.networks.mgmt.pool.start) && (
            <p className="text-sm text-slate-400 font-mono">No IP pools configured. Fill in subnet/pool fields in the Editor tab.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-[11px] uppercase tracking-[0.16em] font-mono border-b-2 transition-colors ${
        active
          ? "text-blue-600 border-blue-600"
          : "text-slate-400 border-transparent hover:text-slate-600"
      }`}
    >
      {children}
    </button>
  );
}

function FleetSummary({ fleet, fleetResult, onChange }) {
  return (
    <div className="border border-blue-200 bg-white shadow-sm rounded-lg p-6 mb-6">
      <div className="flex items-baseline justify-between border-b border-blue-200 pb-2 mb-5">
        <h2 className="font-serif text-3xl text-slate-900 italic">Fleet Summary</h2>
        <span className="text-[10px] uppercase tracking-[0.2em] text-blue-600 font-mono">
          Aggregated across all sites
        </span>
      </div>

      {/* Plan 9 polish — Report Metadata at the top so deliverable info
          (client, project, prepared-by, revision, date) is the first
          thing a user encounters in Fleet Summary. Drives the PDF cover. */}
      {onChange && <ReportMetadataPanel fleet={fleet} onChange={onChange} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Total Hosts"      value={fleetResult.totalHosts}                         mono />
        <Stat label="Licensed Cores"   value={fmt(fleetResult.totalCores)}                    mono />
        <Stat label="vSAN Entitlement" value={`${fmt(fleetResult.entitlementTib, 0)} TiB`}    mono />
        <Stat label="Fleet Raw vSAN"   value={`${fmt(fleetResult.fleetRawTib, 1)} TiB`}       mono />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
        <Stat label="Sites"             value={fleet.sites.length}                                                                  mono />
        <Stat label="VCF Instances"     value={fleet.instances.length}                                                              mono />
        <Stat label="Total Domains"     value={fleet.instances.reduce((s, inst) => s + inst.domains.length, 0)}                     mono />
      </div>

      <div className={`border rounded p-4 ${
        fleetResult.addonTib > 0
          ? "border-rose-400 bg-rose-50"
          : "border-emerald-400 bg-emerald-50"
      }`}>
        <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500 mb-1 font-mono">
          Add-on TiB Required
        </div>
        <div className="font-serif text-3xl text-slate-900">
          {fmt(fleetResult.addonTib, 1)} <span className="text-base text-slate-500">TiB</span>
        </div>
        <div className="text-[11px] text-slate-400 mt-1">
          {fleetResult.addonTib > 0
            ? "Fleet raw exceeds bundled entitlement — additional vSAN capacity licensing needed."
            : "Fleet raw fits within bundled core entitlement."}
        </div>
      </div>

      {/* ─── Fleet Network Configuration ─── */}
      {onChange && (
        <div className="border-t border-blue-200 pt-4 mt-4">
          <h3 className="text-[11px] uppercase tracking-[0.18em] text-blue-700 font-semibold mb-3">Fleet Network Configuration</h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono block mb-1">DNS Servers</label>
              <input
                value={(fleet.networkConfig?.dns?.servers || []).join(", ")}
                onChange={(e) => {
                  const servers = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                  onChange({ ...fleet, networkConfig: { ...fleet.networkConfig, dns: { ...fleet.networkConfig?.dns, servers } } });
                }}
                placeholder="10.1.1.1, 10.1.1.2"
                className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1.5 w-full text-slate-700"
                title="VCF-NET-001: Comma-separated DNS server IPs"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono block mb-1">NTP Servers</label>
              <input
                value={(fleet.networkConfig?.ntp?.servers || []).join(", ")}
                onChange={(e) => {
                  const servers = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                  onChange({ ...fleet, networkConfig: { ...fleet.networkConfig, ntp: { ...fleet.networkConfig?.ntp, servers } } });
                }}
                placeholder="pool.ntp.org, time.google.com"
                className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1.5 w-full text-slate-700"
                title="VCF-NET-004: Comma-separated NTP server hostnames or IPs"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono block mb-1">DNS Primary Domain</label>
              <input
                value={fleet.networkConfig?.dns?.primaryDomain || ""}
                onChange={(e) => {
                  onChange({ ...fleet, networkConfig: { ...fleet.networkConfig, dns: { ...fleet.networkConfig?.dns, primaryDomain: e.target.value } } });
                }}
                placeholder="vcf.example.com"
                className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1.5 w-full text-slate-700"
                title="VCF-NET-003: Primary DNS domain for SRV record discovery"
              />
            </div>
          </div>
        </div>
      )}
      {onChange && <NamingConventionsPanel fleet={fleet} onChange={onChange} />}
    </div>
  );
}

// Plan 8 — Report Metadata panel. Renders inside FleetSummary; owns
// fleet.reportMetadata which feeds the PDF cover page (PR 8b). Empty
// fields render as "—" in the cover; the user opts in by populating
// any subset.
function ReportMetadataPanel({ fleet, onChange }) {
  const m = fleet.reportMetadata || createFleetReportMetadata();
  const update = (patch) =>
    onChange({ ...fleet, reportMetadata: { ...m, ...patch } });
  const todayIso = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };
  return (
    <div className="rounded-lg border-2 border-blue-300 bg-gradient-to-br from-blue-50 via-sky-50 to-indigo-50 p-4 mb-5 shadow-sm">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-[12px] uppercase tracking-[0.18em] text-blue-800 font-semibold flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-600"></span>
          Report Metadata · PDF Cover
        </h3>
        <span className="text-[10px] text-blue-600 font-mono italic">
          Print / Save as PDF → cover page
        </span>
      </div>
      <p className="text-[11px] text-slate-600 font-mono leading-relaxed mb-3">
        Client / project info for deliverables. Persists with the fleet
        (round-trips through Export JSON). Empty fields render as &mdash;
        on the cover; <code>documentDate</code> defaults to today's date
        at print time when blank.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono block mb-1">Client Name</label>
          <input
            value={m.clientName || ""}
            onChange={(e) => update({ clientName: e.target.value })}
            placeholder="Acme Corp"
            className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1.5 w-full text-slate-700"
            title="Name of the client this design is being delivered to."
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono block mb-1">Project ID</label>
          <input
            value={m.projectId || ""}
            onChange={(e) => update({ projectId: e.target.value })}
            placeholder="VCF-2026-Q2"
            className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1.5 w-full text-slate-700"
            title="Internal project / engagement identifier."
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono block mb-1">Prepared By</label>
          <input
            value={m.preparedBy || ""}
            onChange={(e) => update({ preparedBy: e.target.value })}
            placeholder="J. Smith, Solutions Architect"
            className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1.5 w-full text-slate-700"
            title="Author of the design (name and role)."
          />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono block mb-1">Revision</label>
          <input
            value={m.revision || ""}
            onChange={(e) => update({ revision: e.target.value })}
            placeholder="Draft 2"
            className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1.5 w-full text-slate-700"
            title="Document revision label, e.g. 'Draft 2', 'v1.0', 'Final'."
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono block mb-1">Document Date</label>
          <div className="flex gap-1">
            <input
              type="date"
              value={m.documentDate || ""}
              onChange={(e) => update({ documentDate: e.target.value })}
              className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1.5 flex-1 text-slate-700"
              title="ISO YYYY-MM-DD. Empty = use today's date when generating the PDF."
            />
            <button
              onClick={() => update({ documentDate: todayIso() })}
              className="text-[10px] font-mono uppercase tracking-wider text-slate-500 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-2"
              title="Set to today's date."
            >
              Today
            </button>
          </div>
        </div>
        <div></div>
      </div>
    </div>
  );
}

// Plan 7 — Naming Conventions panel. Renders inside FleetSummary; owns
// the fleet-level templates and shows a live preview against the first
// cluster in the fleet so users can iterate on the template without
// committing to changes.
function NamingConventionsPanel({ fleet, onChange }) {
  const [showTokenRef, setShowTokenRef] = useState(false);
  const cfg = fleet.namingConfig || createFleetNamingConfig();
  const updateCfg = (patch) =>
    onChange({ ...fleet, namingConfig: { ...cfg, ...patch } });

  // Pick the first instance / first workload domain (or mgmt if no WLDs)
  // / first cluster as the live-preview anchor.
  const previewInst = (fleet.instances || [])[0];
  const previewDomain = previewInst
    ? (previewInst.domains || []).find((d) => d.type === "workload")
      || (previewInst.domains || [])[0]
    : null;
  const previewCluster = previewDomain ? (previewDomain.clusters || [])[0] : null;

  // Build host preview rows by resolving against indices 0..2.
  const hostPreview = previewCluster
    ? [0, 1, 2].map((i) => ({
        idx: i,
        name: resolveHostname(fleet, previewInst, previewDomain, previewCluster, i),
      }))
    : [];

  // vDS preview shows resolved names for each slot in the cluster's
  // current NIC profile. Empty template renders as null per slot.
  const vdsPreview = previewCluster
    ? (previewCluster.networks?.vds || []).map((slot, i) => ({
        idx: i,
        existing: slot.name,
        resolved: resolveVdsName(fleet, previewInst, previewDomain, previewCluster, i),
      }))
    : [];

  return (
    <div className="border-t border-blue-200 pt-4 mt-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[11px] uppercase tracking-[0.18em] text-blue-700 font-semibold">
          Naming Conventions
        </h3>
        <button
          onClick={() => setShowTokenRef((s) => !s)}
          className="text-[10px] uppercase tracking-wider text-slate-500 hover:text-blue-600 font-mono"
        >
          {showTokenRef ? "Hide tokens" : "Show tokens"}
        </button>
      </div>

      <p className="text-[11px] text-slate-500 font-mono leading-relaxed mb-3">
        Token-based templates for ESXi hostnames and vDS switch names. Empty
        templates produce <code>hostname: null</code> in exports (preserves
        legacy behavior). Cluster-level overrides and per-host literals beat
        the fleet template.
      </p>

      {showTokenRef && (
        <div className="text-[10px] font-mono text-slate-600 bg-slate-50 border border-slate-200 rounded p-3 mb-3 leading-relaxed">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <div><strong>{"{prefix}"}</strong> — fleet prefix</div>
            <div><strong>{"{postfix}"}</strong> — fleet postfix (e.g. .lab.local)</div>
            <div><strong>{"{site}"}</strong> — site name slug</div>
            <div><strong>{"{instance}"}</strong> — instance name slug</div>
            <div><strong>{"{cluster}"}</strong> — cluster name slug</div>
            <div><strong>{"{role}"}</strong> / <strong>{"{domain}"}</strong> — mgmt or wld</div>
            <div><strong>{"{purpose}"}</strong> — vDS only (mgmt, vmotion, vsan, tep, …)</div>
            <div><strong>{"{seq}"}</strong>, <strong>{"{seq:02}"}</strong>, <strong>{"{seq:03}"}</strong> — host index, optional zero-padding</div>
          </div>
          <div className="mt-2 text-slate-500">
            Unknown tokens render as empty; runs of the separator are collapsed. Leading dots in postfix are preserved.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 mb-3">
        <div>
          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono block mb-1">Prefix</label>
          <input
            value={cfg.prefix || ""}
            onChange={(e) => updateCfg({ prefix: e.target.value })}
            placeholder="vcf"
            className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1.5 w-full text-slate-700"
            title="Used for {prefix} token in templates."
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono block mb-1">Postfix</label>
          <input
            value={cfg.postfix || ""}
            onChange={(e) => updateCfg({ postfix: e.target.value })}
            placeholder=".lab.local"
            className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1.5 w-full text-slate-700"
            title="Used for {postfix} token. Typically the primary DNS domain (.lab.local). Leading dot is preserved."
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono block mb-1">Seq Start</label>
          <input
            type="number"
            min="0"
            value={cfg.seqStart ?? 1}
            onChange={(e) => updateCfg({ seqStart: parseInt(e.target.value, 10) || 0 })}
            className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1.5 w-full text-slate-700"
            title="First host index in resolved names. vCenter conventionally starts at 1."
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono block mb-1">Seq Padding</label>
          <input
            type="number"
            min="0"
            max="6"
            value={cfg.seqPadding ?? 2}
            onChange={(e) => updateCfg({ seqPadding: parseInt(e.target.value, 10) || 0 })}
            className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1.5 w-full text-slate-700"
            title="Default padding when {seq} is used without :NN. {seq:02} overrides per-template."
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono block mb-1">Host Template</label>
          <input
            value={cfg.hostTemplate || ""}
            onChange={(e) => updateCfg({ hostTemplate: e.target.value })}
            placeholder="{prefix}-{site}-{role}-{seq:02}{postfix}"
            className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1.5 w-full text-slate-700"
            title="Empty = no hostname (legacy behavior). Cluster + per-host overrides take precedence."
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono block mb-1">vDS Template</label>
          <input
            value={cfg.vdsTemplate || ""}
            onChange={(e) => updateCfg({ vdsTemplate: e.target.value })}
            placeholder="{prefix}-{cluster}-vds-{purpose}"
            className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1.5 w-full text-slate-700"
            title="Empty = preserve stored vDS names. User must click 'Re-apply' on each cluster to apply changes — names are not auto-updated."
          />
        </div>
      </div>

      {previewCluster && (
        <div className="bg-slate-50 border border-slate-200 rounded p-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono mb-2">
            Live Preview · {previewInst?.name} / {previewDomain?.name} / {previewCluster.name}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] text-slate-400 font-mono mb-1">Hostnames</div>
              {hostPreview.map((h) => (
                <div key={h.idx} className="text-[11px] font-mono text-slate-700">
                  host {h.idx}: <span className={h.name ? "text-blue-700" : "text-slate-400 italic"}>
                    {h.name || "(no template — null)"}
                  </span>
                </div>
              ))}
            </div>
            <div>
              <div className="text-[10px] text-slate-400 font-mono mb-1">vDS Names</div>
              {vdsPreview.map((v) => (
                <div key={v.idx} className="text-[11px] font-mono text-slate-700">
                  vds {v.idx}: <span className="text-slate-700">{v.existing}</span>
                  {v.resolved && v.resolved !== v.existing && (
                    <span className="text-blue-600"> → {v.resolved}</span>
                  )}
                </div>
              ))}
              {!cfg.vdsTemplate && (
                <div className="text-[10px] text-slate-400 italic mt-1">
                  Set a vDS template above and use the cluster's "Re-apply" button to update stored names.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
