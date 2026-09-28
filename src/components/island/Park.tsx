import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hash } from "@/lib/island/rng";
import { gateOf, ruinSite, trailNetwork, type Crossing, type RuinSite } from "@/lib/island/park";
import { wx, wz, type Tile } from "@/lib/island/types";
import { heightAt, tileAtWorld } from "./palette";
import { METRE, PropField, type Placement, type PropKey } from "./Props";
import PROP_META from "./props.meta.json";

/**
 * The old park and the ways through the island: dirt trails worn out from
 * the tribe's home, plank and rope bridges where they cross the rivers and
 * the gorge, and the ruins of a fenced compound the jungle has taken back —
 * a broken gateway, roofless concrete sheds, rusted iron, a car under a
 * rotten cover, leaning fence and dead power lines.
 */

// --- Textures (Poly Haven, CC0) ----------------------------------------------

const loader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
function tex(name: string, colour: boolean) {
  let t = texCache.get(name);
  if (!t) {
    t = loader.load(`/props/tex/${name}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (colour) t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(name, t);
  }
  return t;
}
function surface(name: string, opts: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({
    map: tex(`${name}_diff`, true),
    normalMap: tex(`${name}_nor`, false),
    roughness: 0.95,
    metalness: 0,
    ...opts,
  });
}

// --- Geometry helpers ----------------------------------------------------------

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/** A box whose texture keeps its scale however the box is stretched. */
function box(
  w: number,
  h: number,
  d: number,
  at: [number, number, number],
  rot: [number, number, number] = [0, 0, 0],
  k = 2,
) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] * k, uv.getY(i) * dims[f][1] * k);
    }
  g.applyMatrix4(_m.compose(_v.set(...at), _q.setFromEuler(_e.set(...rot)), _s.set(1, 1, 1)));
  return g;
}

function merged(parts: THREE.BufferGeometry[]) {
  if (!parts.length) return null;
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

// --- Trails ------------------------------------------------------------------

/** Rounds off a tile-by-tile path into a smooth line. */
function smooth(pts: [number, number][], rounds = 3) {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    const q: [number, number][] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      q.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25]);
      q.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/** Evenly spaced points along a line. */
function resample(p: [number, number][], step: number) {
  const out: [number, number][] = [p[0]];
  let carry = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i];
    const [bx, bz] = p[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    let d = step - carry;
    while (d <= len) {
      out.push([ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len]);
      d += step;
    }
    carry = len - (d - step);
  }
  return out;
}

export function trailGeometry(tiles: Tile[], lines: [number, number][][]) {
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const W = 0.2;
  const across = [-1, -0.45, 0.45, 1];
  const alpha = [0, 1, 1, 0];
  for (const line of lines) {
    const p = resample(line, 0.18);
    let dist = 0;
    let prevRow = -1;
    for (let i = 0; i < p.length; i++) {
      const [x, z] = p[i];
      const a = p[Math.max(0, i - 1)];
      const b = p[Math.min(p.length - 1, i + 1)];
      let dx = b[0] - a[0];
      let dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      if (i > 0) dist += Math.hypot(x - p[i - 1][0], z - p[i - 1][1]);
      const t = tileAtWorld(x, z);
      const wet = t < 0 || tiles[t].water !== 0;
      // Worn wider in places, narrower in others.
      const w = W * (0.8 + 0.4 * hash(Math.floor(dist * 2), 71));
      const row = pos.length / 3;
      for (let k = 0; k < 4; k++) {
        const ox = -dz * across[k] * w;
        const oz = dx * across[k] * w;
        const px = x + ox;
        const pz = z + oz;
        pos.push(px, heightAt(tiles, px, pz) + 0.05, pz);
        // Fades out at the ends, and at the water's edge (the bridge takes over).
        const end = Math.min(1, dist / 0.6, (i === p.length - 1 ? 0 : 1) + 0.0);
        col.push(1, 1, 1, wet ? 0 : alpha[k] * end);
        uv.push((across[k] + 1) * 0.5 * 0.6, dist * 1.4);
      }
      if (prevRow >= 0)
        for (let k = 0; k < 3; k++) {
          const a0 = prevRow + k;
          const b0 = row + k;
          index.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0);
        }
      prevRow = row;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// --- Bridges -------------------------------------------------------------------

interface BridgeGeo {
  planks: THREE.BufferGeometry | null;
  beams: THREE.BufferGeometry | null;
  rope: THREE.BufferGeometry | null;
}

export function bridgeGeometry(tiles: Tile[], crossings: Crossing[]): BridgeGeo {
  const planks: THREE.BufferGeometry[] = [];
  const beams: THREE.BufferGeometry[] = [];
  const rope: THREE.BufferGeometry[] = [];
  crossings.forEach((c, n) => {
    let ax = wx(c.from);
    let az = wz(c.from);
    let bx = wx(c.to);
    let bz = wz(c.to);
    const len0 = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len0;
    const uz = (bz - az) / len0;
    // Anchored a little way back from each bank.
    ax += ux * 0.15;
    az += uz * 0.15;
    bx -= ux * 0.15;
    bz -= uz * 0.15;
    const len = Math.hypot(bx - ax, bz - az);
    const ya = heightAt(tiles, ax, az) + 0.06;
    const yb = heightAt(tiles, bx, bz) + 0.06;
    const river = Math.min(...c.span.map((i) => tiles[i].h));
    const deep = Math.min(ya, yb) - river > 0.8;
    // A rope bridge sags over a gorge; a plank bridge humps over a stream.
    const bend = deep ? -0.06 * len - 0.05 : 0.05 + 0.03 * len;
    const yaw = Math.atan2(ux, uz);
    const at = (t: number) => {
      const y = ya + (yb - ya) * t + bend * 4 * t * (1 - t);
      return [ax + (bx - ax) * t, y, az + (bz - az) * t] as [number, number, number];
    };
    const W = 0.34;
    const pitch = Math.atan2(yb - ya, len);
    // Planks across, a few gone or skewed.
    const count = Math.round(len / 0.075);
    for (let k = 0; k <= count; k++) {
      if (hash(n, k, 91) < (deep ? 0.08 : 0.04)) continue;
      const t = k / count;
      const [x, y, z] = at(t);
      const slope = Math.atan2(
        at(Math.min(1, t + 0.01))[1] - at(Math.max(0, t - 0.01))[1],
        len * 0.02,
      );
      planks.push(
        box(
          W * (0.9 + hash(n, k, 92) * 0.2),
          0.022,
          0.062,
          [x, y + (hash(n, k, 93) - 0.5) * 0.01, z],
          [-slope || -pitch, yaw + (hash(n, k, 94) - 0.5) * 0.12, 0],
          6,
        ),
      );
    }
    // Two stringers under the planks, in short straight runs.
    const runs = Math.max(2, Math.ceil(len / 0.4));
    for (const side of [-1, 1])
      for (let r = 0; r < runs; r++) {
        const p = at(r / runs);
        const q = at((r + 1) / runs);
        const mx = (p[0] + q[0]) / 2 - uz * side * W * 0.38;
        const mz = (p[2] + q[2]) / 2 + ux * side * W * 0.38;
        const l = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
        const s = Math.atan2(q[1] - p[1], Math.hypot(q[0] - p[0], q[2] - p[2]));
        beams.push(
          box(0.045, 0.045, l + 0.02, [mx, (p[1] + q[1]) / 2 - 0.034, mz], [-s, yaw, 0], 4),
        );
      }
    // Posts: at the ends, and down into the stream bed for a plank bridge.
    const postsAt = deep ? [0, 1] : [0, 0.5, 1];
    for (const t of postsAt)
      for (const side of [-1, 1]) {
        const [x, y, z] = at(t);
        const px = x - uz * side * W * 0.55;
        const pz = z + ux * side * W * 0.55;
        const foot = t === 0 || t === 1 ? heightAt(tiles, px, pz) - 0.1 : river - 0.3;
        const top = y + (deep ? 0.36 : 0.26);
        beams.push(
          box(
            0.05,
            top - foot,
            0.05,
            [px, (top + foot) / 2, pz],
            [0, yaw + hash(n, t * 9, side) * 0.3, 0],
            4,
          ),
        );
      }
    // Hand ropes (or a rail) along both sides, sagging between the posts.
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        const [x, y, z] = at(t);
        const sag = deep ? 0.34 - 0.05 * Math.sin(t * Math.PI) : 0.24;
        pts.push(new THREE.Vector3(x - uz * side * W * 0.55, y + sag, z + ux * side * W * 0.55));
      }
      rope.push(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, deep ? 0.009 : 0.016, 5),
      );
      // Hangers tying rope to planks over the gorge.
      if (deep)
        for (let k = 1; k < 8; k++) {
          const t = k / 8;
          const [x, y, z] = at(t);
          const top = pts[Math.round(t * 16)];
          const px = x - uz * side * W * 0.5;
          const pz = z + ux * side * W * 0.5;
          rope.push(
            new THREE.TubeGeometry(
              new THREE.LineCurve3(new THREE.Vector3(px, y, pz), top),
              1,
              0.006,
              4,
            ),
          );
        }
    }
  });
  const strip = (list: THREE.BufferGeometry[]) =>
    merged(list.map((g) => (g.index ? g.toNonIndexed() : g)));
  return { planks: strip(planks), beams: strip(beams), rope: strip(rope) };
}

// --- The ruins -----------------------------------------------------------------

interface Hall {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Which side (0 +z front, 1 -z, 2 +x, 3 -x) is open / has the door. */
  door: number;
  wide?: boolean;
  /** 0–1: how much of the roof is still up. */
  roof: number;
  seed: number;
}

const HALLS: Hall[] = [
  // The visitor hall, the biggest, half its roof fallen in.
  { x: -1.35, z: -0.85, w: 2.2, d: 1.3, h: 0.72, door: 0, roof: 0.45, seed: 1 },
  // A vehicle shed, open at the front.
  { x: 1.55, z: -1.05, w: 1.35, d: 1.05, h: 0.58, door: 0, wide: true, roof: 0.7, seed: 2 },
  // The guard hut by the gate.
  { x: 2.2, z: 1.55, w: 0.55, d: 0.55, h: 0.5, door: 3, roof: 0.9, seed: 3 },
];

export function ruinGeometry(site: RuinSite) {
  const concrete: THREE.BufferGeometry[] = [];
  const iron: THREE.BufferGeometry[] = [];
  const T = 0.06;
  // The yard: a cracked concrete apron behind the gate.
  concrete.push(box(1.3, 0.05, 2.2, [0, 0.0, 1.35], [0, 0, 0], 1.5));
  for (const b of HALLS) {
    const hh = (k: number) => hash(b.seed, k, 51);
    concrete.push(box(b.w + 0.12, 0.06, b.d + 0.12, [b.x, 0.01, b.z], [0, 0, 0], 1.5));
    // A collapsed corner: the walls step down towards it.
    const cornerX = hh(1) < 0.5 ? -1 : 1;
    const cornerZ = hh(2) < 0.5 ? -1 : 1;
    const sides = [
      { axis: "x", len: b.w, off: b.d / 2, sgn: 1 },
      { axis: "x", len: b.w, off: -b.d / 2, sgn: -1 },
      { axis: "z", len: b.d, off: b.w / 2, sgn: 1 },
      { axis: "z", len: b.d, off: -b.w / 2, sgn: -1 },
    ];
    sides.forEach((s, si) => {
      const pieces = Math.max(2, Math.round(s.len / 0.22));
      const pl = s.len / pieces;
      for (let k = 0; k < pieces; k++) {
        const u = -s.len / 2 + (k + 0.5) * pl;
        const lx = s.axis === "x" ? b.x + u : b.x + s.off;
        const lz = s.axis === "x" ? b.z + s.off : b.z + u;
        // Distance to the fallen corner: the nearer, the lower the wall.
        const dc = Math.hypot(
          (lx - (b.x + (cornerX * b.w) / 2)) / b.w,
          (lz - (b.z + (cornerZ * b.d) / 2)) / b.d,
        );
        const fallen = b.roof < 0.8 ? Math.max(0, 1 - dc * 1.6) : 0;
        let top = b.h * (1 - fallen * (0.55 + hh(k + si * 20) * 0.4));
        top *= 0.95 + hh(k + si * 20 + 7) * 0.08;
        const mid = Math.abs(u) < (b.wide ? s.len * 0.36 : 0.16);
        if (si === b.door && mid) {
          // A doorway (or the shed's open front): only the lintel above, if it held.
          if (!b.wide && hh(k + 40) < 0.7 && top > b.h * 0.8) {
            const [w, d] = s.axis === "x" ? [pl, T] : [T, pl];
            concrete.push(box(w, b.h * 0.18, d, [lx, top - b.h * 0.09, lz]));
          }
          continue;
        }
        const window = !b.wide && k % 3 === 1 && top > b.h * 0.7;
        const [w, d] = s.axis === "x" ? [pl + 0.005, T] : [T, pl + 0.005];
        if (window) {
          concrete.push(box(w, b.h * 0.38, d, [lx, b.h * 0.19, lz]));
          concrete.push(box(w, top - b.h * 0.72, d, [lx, (top + b.h * 0.72) / 2, lz]));
        } else concrete.push(box(w, top, d, [lx, top / 2, lz]));
      }
    });
    // Rubble where the corner came down.
    for (let k = 0; k < 6; k++) {
      const rx = b.x + (cornerX * b.w) / 2 + (hh(60 + k) - 0.5) * 0.6;
      const rz = b.z + (cornerZ * b.d) / 2 + (hh(70 + k) - 0.5) * 0.6;
      const s = 0.08 + hh(80 + k) * 0.12;
      concrete.push(
        box(
          s * 1.6,
          s * 0.5,
          s,
          [rx, s * 0.2, rz],
          [hh(90 + k) - 0.5, hh(100 + k) * 3, hh(110 + k) - 0.5],
        ),
      );
    }
    // Rusted iron roof sheets on a slope, some slipped, some gone.
    const sheets = Math.round(b.w / 0.2);
    const slope = 0.16;
    for (let k = 0; k < sheets; k++) {
      const u = -b.w / 2 + (k + 0.5) * (b.w / sheets);
      const gone = hash(b.seed, k, 57) > b.roof;
      const nearFall = Math.hypot((u - (cornerX * b.w) / 2) / b.w, 0.5) < 0.55 && b.roof < 0.8;
      if (gone && nearFall) {
        // Fallen in: lying across the floor at an angle.
        if (hash(b.seed, k, 58) < 0.6)
          iron.push(
            box(
              b.w / sheets - 0.01,
              0.012,
              b.d * 0.9,
              [b.x + u, 0.12 + hash(b.seed, k, 59) * 0.15, b.z],
              [
                0.3 + hash(b.seed, k, 60) * 0.5,
                (hash(b.seed, k, 61) - 0.5) * 0.4,
                (hash(b.seed, k, 62) - 0.5) * 0.3,
              ],
              3,
            ),
          );
        continue;
      }
      if (gone) continue;
      const droop = hash(b.seed, k, 63) < 0.25 ? 0.12 + hash(b.seed, k, 64) * 0.15 : 0;
      iron.push(
        box(
          b.w / sheets - 0.012,
          0.012,
          b.d + 0.16,
          [b.x + u, b.h + 0.02 - droop * 0.3, b.z],
          [slope + droop, (hash(b.seed, k, 65) - 0.5) * 0.05, 0],
          3,
        ),
      );
    }
  }
  // The gateway: two tall pillars and a lintel that has cracked and dropped at one end.
  const gz = site.d;
  for (const side of [-1, 1]) {
    concrete.push(box(0.28, 1.4, 0.28, [side * 0.66, 0.7, gz]));
    concrete.push(box(0.36, 0.08, 0.36, [side * 0.66, 1.42, gz]));
    concrete.push(box(0.2, 0.3, 0.3, [side * 0.8, 0.15, gz], [0, 0, 0]));
  }
  concrete.push(box(0.9, 0.18, 0.22, [-0.35, 1.3, gz], [0, 0, -0.04]));
  concrete.push(box(0.75, 0.18, 0.22, [0.42, 1.08, gz + 0.02], [0.05, 0.02, 0.62]));
  // Pieces of it on the ground.
  concrete.push(box(0.3, 0.14, 0.2, [0.25, 0.07, gz + 0.35], [0.2, 0.7, 0.1]));
  concrete.push(box(0.18, 0.1, 0.14, [-0.1, 0.05, gz + 0.5], [0.3, 1.9, 0.2]));
  return { concrete: merged(concrete), iron: merged(iron) };
}

/** Where the loose props go in and around the ruins, in the compound's own frame. */
export function ruinProps(
  tiles: Tile[],
  site: RuinSite,
  trail: [number, number][] | null,
): Placement[] {
  const out: Placement[] = [];
  const cos = Math.cos(site.yaw);
  const sin = Math.sin(site.yaw);
  const toWorld = (lx: number, lz: number) => ({
    x: site.x + lx * cos + lz * sin,
    z: site.z - lx * sin + lz * cos,
  });
  const put = (
    key: PropKey,
    lx: number,
    lz: number,
    yaw: number,
    scale: number,
    opts: {
      lean?: number;
      roll?: number;
      sink?: number;
      y?: number;
      shade?: number;
      world?: boolean;
    } = {},
  ) => {
    const p = opts.world ? { x: lx, z: lz } : toWorld(lx, lz);
    const s = scale * METRE;
    const size = PROP_META[key].size;
    const y = (opts.y ?? heightAt(tiles, p.x, p.z)) - size[1] * s * (opts.sink ?? 0.02);
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(opts.lean ?? 0, (opts.world ? 0 : site.yaw) + yaw, opts.roll ?? 0, "YXZ"),
    );
    out.push({
      key,
      m: new THREE.Matrix4().compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(s, s, s)),
      color: new THREE.Color().setScalar(opts.shade ?? 1),
    });
  };
  const h = (k: number) => hash(site.tile, k, 33);
  // The chain-link fence round the yard: gaps, leaning panels, a few flat on the ground.
  const S = 1.45;
  const L = PROP_META.fence.size[0] * METRE * S;
  const W = site.w;
  const D = site.d;
  const sides: [number, number, number, number][] = [
    [-W, D, W, D],
    [W, D, W, -D],
    [W, -D, -W, -D],
    [-W, -D, -W, D],
  ];
  sides.forEach(([x0, z0, x1, z1], si) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.round(len / L);
    const yaw = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const lx = x0 + (x1 - x0) * t;
      const lz = z0 + (z1 - z0) * t;
      // The gateway breaks the front fence.
      if (si === 0 && Math.abs(lx) < 0.85) continue;
      const r = h(si * 40 + k);
      if (r < 0.1) continue;
      const lean =
        r < 0.3
          ? (h(si * 40 + k + 5) - 0.5) * 0.9
          : r < 0.36
            ? 1.45
            : (h(si * 40 + k + 6) - 0.5) * 0.08;
      put("fence", lx, lz, yaw, S, { lean, sink: lean > 1 ? 0 : 0.03 });
      if (lean < 1) {
        const tp = k / n;
        put("fence_post", x0 + (x1 - x0) * tp, z0 + (z1 - z0) * tp, 0, S, { lean: lean * 0.8 });
      }
    }
  });
  // The iron gates: one hanging open off its pillar, the other torn off and lying in the weeds.
  put("gate", -0.66 + 0.06, D + 0.42, -1.3, 1.55, { sink: 0.02 });
  put("gate", 0.35, D + 1.0, 0.35, 1.55, { lean: -1.5, sink: -0.02 });
  // A concrete barrier knocked askew outside the gate, and the shed's junk.
  put("barrier", -0.2, D + 1.6, 0.5, 1.3, { lean: 0.1 });
  put("barrier", 0.55, D + 1.45, 2.2, 1.3, { roll: 1.5, sink: 0.2 });
  put("car", 1.25, -0.2, 0.9, 1.25, { lean: 0.06, roll: -0.05, sink: 0.12, shade: 0.9 });
  for (let k = 0; k < 5; k++)
    put("tyre", 2.45 + (k % 2) * 0.12, -1.7 + k * 0.03, h(k) * 3, 1.3, {
      y: heightAt(tiles, toWorld(2.45, -1.7).x, toWorld(2.45, -1.7).z) + k * 0.03,
      lean: Math.PI / 2,
      sink: 0,
    });
  put("tyre", 0.6, 0.9, 0.4, 1.3, { roll: 0.2, sink: 0.25 });
  for (let k = 0; k < 6; k++) {
    const tipped = h(k + 20) < 0.4;
    put("barrel", 2.35 - (k % 3) * 0.14, -0.3 - Math.floor(k / 3) * 0.14, h(k + 21) * 6, 1.25, {
      lean: tipped ? Math.PI / 2 : 0,
      sink: tipped ? -0.15 : 0.02,
      shade: 0.8 + h(k + 22) * 0.3,
    });
  }
  for (let k = 0; k < 5; k++)
    put("crate", -2.4 + h(k + 30) * 1.2, 0.1 + h(k + 31) * 0.8, h(k + 32) * 6, 1.6, {
      lean: h(k + 33) < 0.3 ? 0.4 : 0,
    });
  put("utility_box", 2.55, 1.2, -1.2, 1.4, { lean: 0.1 });
  put("wheel_rim", 0.2, 0.6, 1.1, 1.4, { lean: Math.PI / 2, sink: 0 });
  put("wheel_rim", -2.2, 1.6, 2.1, 1.4, { lean: 1.3, sink: 0.1 });
  put("slab", -0.3, -1.9, 0.4, 0.55, { sink: 0.3 });
  put("slab", 0.3, 0.35, 2.2, 0.4, { sink: 0.4 });
  // A trunk fell across the back fence years ago.
  put("dead_trunk", -1.6, -D - 0.1, 0.35, 1.2, { sink: 0.15 });
  put("roots", 2.9, -2.0, 1.2, 0.9, { sink: 0.2 });
  // Dead power lines along the old road out.
  if (trail && trail.length > 4) {
    let dist = 0;
    let next = 0.8;
    let n = 0;
    for (let i = trail.length - 1; i > 0 && n < 7; i--) {
      const [x, z] = trail[i];
      const [px, pz] = trail[i - 1];
      dist += Math.hypot(x - px, z - pz);
      if (dist < next) continue;
      next += 2.4;
      const dx = px - x;
      const dz = pz - z;
      const l = Math.hypot(dx, dz) || 1;
      const side = 0.45;
      const wx0 = x + (dz / l) * side;
      const wz0 = z - (dx / l) * side;
      const t = tileAtWorld(wx0, wz0);
      if (t < 0 || tiles[t].water) continue;
      put("pole", wx0, wz0, Math.atan2(dx, dz) + Math.PI / 2, 1.3, {
        world: true,
        lean: (h(200 + n) - 0.5) * (h(210 + n) < 0.35 ? 0.5 : 0.08),
        roll: (h(220 + n) - 0.5) * 0.15,
        sink: 0.05,
        shade: 0.85,
      });
      n++;
    }
  }
  return out;
}

// --- The whole thing -----------------------------------------------------------

export interface ParkLayout {
  site: RuinSite | null;
  lines: [number, number][][];
  crossings: Crossing[];
  /** Tiles the trails and the compound cover (kept clear of rocks). */
  clear: Set<number>;
}

export function parkLayout(tiles: Tile[]): ParkLayout {
  const { trails, crossings } = trailNetwork(tiles);
  const site = ruinSite(tiles);
  const clear = new Set<number>();
  const lines = trails.map((t) => {
    t.tiles.forEach((i) => clear.add(i));
    const pts = t.tiles.map((i) => [wx(i), wz(i)] as [number, number]);
    return smooth(pts);
  });
  // The trail to the old park runs right up to the gate.
  if (site) {
    const g = gateOf(site, 0.25);
    const near = lines.find((l) => {
      const [x, z] = l[l.length - 1];
      return Math.hypot(x - g.x, z - g.z) < 2.5;
    });
    if (near) near.push([g.x, g.z]);
    for (let i = 0; i < tiles.length; i++)
      if (Math.hypot(wx(i) - site.x, wz(i) - site.z) < site.w + 1.8) clear.add(i);
  }
  return { site, lines, crossings, clear };
}

export function Park({ tiles, layout }: { tiles: Tile[]; layout: ParkLayout }) {
  const trailGeo = useMemo(() => trailGeometry(tiles, layout.lines), [layout]); // eslint-disable-line react-hooks/exhaustive-deps
  const bridges = useMemo(() => bridgeGeometry(tiles, layout.crossings), [layout]); // eslint-disable-line react-hooks/exhaustive-deps
  const ruins = useMemo(() => (layout.site ? ruinGeometry(layout.site) : null), [layout]);
  const props = useMemo(() => {
    if (!layout.site) return [];
    const g = gateOf(layout.site, 0.25);
    const road =
      layout.lines.find((l) => {
        const [x, z] = l[l.length - 1];
        return Math.hypot(x - g.x, z - g.z) < 0.1;
      }) ?? null;
    return ruinProps(tiles, layout.site, road);
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      trailGeo.dispose();
      bridges.planks?.dispose();
      bridges.beams?.dispose();
      bridges.rope?.dispose();
      ruins?.concrete?.dispose();
      ruins?.iron?.dispose();
    },
    [trailGeo, bridges, ruins],
  );
  const mats = useMemo(
    () => ({
      trail: surface("stony_dirt_path", {
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        color: "#efe2cc",
      }),
      plank: surface("weathered_planks", { color: "#b8a58c" }),
      beam: surface("weathered_planks", { color: "#6d5a45" }),
      rope: new THREE.MeshStandardMaterial({ color: "#9c8763", roughness: 1 }),
      concrete: surface("concrete_moss", { color: "#f2f1ea" }),
      iron: surface("rusty_corrugated_iron", {
        side: THREE.DoubleSide,
        roughness: 0.85,
        color: "#b3a597",
      }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const site = layout.site;
  const siteY = site ? heightAt(tiles, site.x, site.z) : 0;
  return (
    <group>
      <mesh geometry={trailGeo} material={mats.trail} receiveShadow renderOrder={1} />
      {bridges.planks && (
        <mesh geometry={bridges.planks} material={mats.plank} castShadow receiveShadow />
      )}
      {bridges.beams && (
        <mesh geometry={bridges.beams} material={mats.beam} castShadow receiveShadow />
      )}
      {bridges.rope && <mesh geometry={bridges.rope} material={mats.rope} castShadow />}
      {site && ruins && (
        <group position={[site.x, siteY - 0.02, site.z]} rotation-y={site.yaw}>
          {ruins.concrete && (
            <mesh geometry={ruins.concrete} material={mats.concrete} castShadow receiveShadow />
          )}
          {ruins.iron && (
            <mesh geometry={ruins.iron} material={mats.iron} castShadow receiveShadow />
          )}
        </group>
      )}
      <PropField placements={props} />
    </group>
  );
}
