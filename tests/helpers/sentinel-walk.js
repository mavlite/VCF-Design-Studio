// Type-aware sentinel stamping for round-trip coverage (M2.1).
//
// Walks a plain object/array tree and replaces each value-bearing leaf with
// a UNIQUE sentinel chosen by the leaf's kind, so a round-trip that drops or
// mis-routes the field shows up as a missing/wrong sentinel. Values for
// constrained fields (vlan / ip / cidr / number) are kept VALID because the
// workbook cell-map validates on apply — an out-of-range sentinel would be
// rejected and look like a (false) round-trip failure.

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const CIDR_RE = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;

// Deterministic per-path spread so sibling fields get distinct values.
function hashPath(path) {
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) >>> 0;
  return h;
}

// A distinct-but-valid octet quartet derived from the path hash, avoiding
// 0/255 in the last octet and keeping the first octet in 10..172.
function ipFor(path) {
  const h = hashPath(path);
  // Use unsigned right-shift (>>>) to avoid signed negative values.
  const a = 10 + (h % 100);              // 10..109
  const b = ((h >>> 3) % 254);           // 0..253
  const c = ((h >>> 6) % 254);           // 0..253
  const d = 1 + ((h >>> 9) % 250);       // 1..250
  return `${a}.${b}.${c}.${d}`;
}

export function sentinelFor(path, current) {
  if (typeof current === "boolean") return !current; // distinct from default
  if (typeof current === "number") {
    const h = hashPath(path);
    if (/vlan/i.test(path)) return 2 + (h % 4092);     // 2..4093, in VLAN range
    if (/mtu/i.test(path)) return 1500 + (h % 7500);   // 1500..8999
    return 1 + (h % 9999);                              // generic distinct int
  }
  if (typeof current === "string") {
    if (CIDR_RE.test(current)) {
      const h = hashPath(path);
      return `${ipFor(path).split(".").slice(0, 3).join(".")}.0/${16 + (h % 12)}`; // /16../27
    }
    if (IP_RE.test(current)) return ipFor(path);
    return `rt::${path}`;
  }
  return undefined; // null/undefined/object handled by walker
}

// stampSentinels(root, opts?)
//
// opts.skip: (path, leafName) => boolean
//   If returns true, the leaf is left at its real value and NOT recorded in
//   sentinels. Use for structural / discriminator / cross-reference fields
//   whose values must stay valid for engine logic to function.
//
// opts.overrides: (path, leafName, current) => value | undefined
//   If returns a non-undefined value, THAT value is stamped instead of the
//   type-derived sentinel. The override IS recorded in sentinels (as the
//   expected value), so the round-trip assertion verifies the field survives
//   with the exact override value. Use for enum fields: stamp a valid
//   alternate enum member so the engine's enum-guard pass-through is exercised.
//
// Backward-compat: the old { skipLeafNames: Set<string> } shape is still
// accepted — it maps to a skip predicate keyed on leaf name.
//
// Default (no opts): identical to the 1-arg form — all leaves stamped.
export function stampSentinels(root, opts = {}) {
  // Support legacy { skipLeafNames: Set<string> } call-shape.
  let skipFn;
  if (typeof opts.skip === "function") {
    skipFn = opts.skip;
  } else if (opts.skipLeafNames instanceof Set) {
    skipFn = (_path, leafName) => opts.skipLeafNames.has(leafName);
  } else {
    skipFn = () => false;
  }

  const overridesFn = typeof opts.overrides === "function" ? opts.overrides : () => undefined;

  const sentinels = {};
  function walk(node, path) {
    if (Array.isArray(node)) {
      return node.map((v, i) => walk(v, path ? `${path}.${i}` : String(i)));
    }
    if (node && typeof node === "object") {
      const out = {};
      for (const k of Object.keys(node)) out[k] = walk(node[k], path ? `${path}.${k}` : k);
      return out;
    }
    if (node === null || node === undefined) return node;
    // Determine the leaf name (last segment of the path).
    const leafName = path ? path.split(".").pop() : "";
    if (skipFn(path, leafName)) return node; // keep original, don't record
    // Check for a caller-supplied override (e.g. a valid enum alternate).
    const override = overridesFn(path, leafName, node);
    if (override !== undefined) {
      sentinels[path] = override;
      return override;
    }
    const s = sentinelFor(path, node);
    if (s === undefined) return node;
    sentinels[path] = s;
    return s;
  }
  const stamped = walk(root, "");
  return { stamped, sentinels };
}
