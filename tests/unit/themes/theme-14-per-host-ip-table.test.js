import { describe, it } from "vitest";

// Theme 14 — Per-host IP table export
//
// EXPORT-ONLY work. Studio already models cluster.hostOverrides[i].
// {mgmtIp, vmotionIp, vsanIp, hostTepIps, hostname}. The hostname is
// the only field that round-trips today (via cellPattern expansion).
// IPs are absent from WORKBOOK_CELL_MAP.
//
// Target cells: Deploy WLD D58–D77, D81–D146, Deploy Cluster D24–D111,
// Configure WLD D241–D300. ~80 cells per sheet.
//
// Acceptance:
//   - WORKBOOK_CELL_MAP carries cellPattern entries for per-host
//     mgmtIp/vmotionIp/vsanIp/hostTepIp across all hosts in cluster
//   - Pool gateway full CIDR + range start/end also exported
//   - Import round-trip rebuilds hostOverrides[]
//   - Existing hostname expansion stays intact
//   - verify-cell-map green

describe.todo("Theme 14 — per-host IP table export (TRACKING)");
