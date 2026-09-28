import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { hash } from "@/lib/island/rng";
import { HALF, RESTRICTED, SEA, SIZE, idx, type RegionId, type Tile } from "@/lib/island/types";
import { heightAt } from "./palette";
import { env } from "./fx/env";

/**
 * The park's zones drawn onto the land: dashed borders between the regions,
 * and a fence of posts and wire around the restricted north. On the park map
 * the borders glow cyan and the restricted line burns red.
 */

export interface Border {
  pts: [number, number][];
  restricted: boolean;
}

const OPEN_WATER: RegionId[] = ["coast", "offshore"];

/** Region borders as smooth polylines, in world x/z. */
export function zoneBorders(tiles: Tile[]): Border[] {
  const land = (i: number) => tiles[i].water !== SEA && !OPEN_WATER.includes(tiles[i].region);
  // Edges of the tile grid between two regions; vertices are grid corners.
  const V = SIZE + 1;
  const segs: { a: number; b: number; r: boolean }[] = [];
  const isR = (i: number) => RESTRICTED.includes(tiles[i].region);
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) {
      const i = idx(x, z);
      if (!land(i)) continue;
      if (x + 1 < SIZE) {
        const j = idx(x + 1, z);
        if (land(j) && tiles[j].region !== tiles[i].region)
          segs.push({ a: z * V + x + 1, b: (z + 1) * V + x + 1, r: isR(i) !== isR(j) });
      }
      if (z + 1 < SIZE) {
        const j = idx(x, z + 1);
        if (land(j) && tiles[j].region !== tiles[i].region)
          segs.push({ a: (z + 1) * V + x, b: (z + 1) * V + x + 1, r: isR(i) !== isR(j) });
      }
    }
  // Join the edges into chains, keeping restricted and ordinary borders apart.
  const out: Border[] = [];
  for (const kind of [false, true]) {
    const mine = segs.filter((s) => s.r === kind);
    const at = new Map<number, number[]>();
    mine.forEach((s, k) => {
      for (const v of [s.a, s.b]) {
        if (!at.has(v)) at.set(v, []);
        at.get(v)!.push(k);
      }
    });
    const used = new Set<number>();
    const walk = (start: number) => {
      const chain = [start];
      let v = start;
      for (;;) {
        const next = (at.get(v) ?? []).find((k) => !used.has(k));
        if (next === undefined) break;
        used.add(next);
        v = mine[next].a === v ? mine[next].b : mine[next].a;
        chain.push(v);
      }
      return chain;
    };
    // Open chains from their ends first, then any closed loops.
    const starts = [...at.keys()].filter((v) => at.get(v)!.length !== 2);
    for (const v of [...starts, ...at.keys()]) {
      while ((at.get(v) ?? []).some((k) => !used.has(k))) {
        const chain = walk(v);
        if (chain.length < 4) continue;
        let pts = chain.map((c) => [(c % V) - HALF, Math.floor(c / V) - HALF] as [number, number]);
        // Ease out the tile staircase: average neighbours, then cut the corners.
        for (let it = 0; it < 3; it++)
          pts = pts.map((p, k) => {
            if (k < 2 || k > pts.length - 3) return p;
            let sx = 0;
            let sz = 0;
            for (let d = -2; d <= 2; d++) {
              sx += pts[k + d][0];
              sz += pts[k + d][1];
            }
            return [sx / 5, sz / 5] as [number, number];
          });
        // Round off what's left: a few passes of corner cutting.
        for (let it = 0; it < 3; it++) {
          const sm: [number, number][] = [pts[0]];
          for (let k = 0; k < pts.length - 1; k++) {
            const [ax, az] = pts[k];
            const [bx, bz] = pts[k + 1];
            sm.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25]);
            sm.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
          }
          sm.push(pts[pts.length - 1]);
          pts = sm;
        }
        out.push({ pts, restricted: kind });
      }
    }
  }
  return out;
}

const LINE_VERT = /* glsl */ `
attribute float aSide;
attribute float aDist;
attribute vec2 aAcross;
uniform float uPx;
uniform float uMinW;
varying float vDist;
varying float vSide;
void main() {
  vec3 p = position;
  // A constant width on screen, however far away the camera is.
  float d = length(cameraPosition - p);
  p.xz += aAcross * aSide * max(uMinW, d * uPx);
  vDist = aDist;
  vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const LINE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uDash;
uniform float uOpacity;
uniform float uGlow;
varying float vDist;
varying float vSide;
void main() {
  float on = uDash > 0.0 ? step(0.45, fract(vDist / uDash)) : 1.0;
  if (on < 0.5) discard;
  float core = 1.0 - smoothstep(0.35, 1.0, abs(vSide));
  vec3 col = uColor * (1.0 + uGlow * core);
  gl_FragColor = vec4(col, uOpacity * mix(0.55, 1.0, core));
}`;

function lineGeometry(tiles: Tile[], lines: Border[]) {
  const pos: number[] = [];
  const side: number[] = [];
  const dist: number[] = [];
  const across: number[] = [];
  const index: number[] = [];
  let base = 0;
  for (const { pts } of lines) {
    let run = 0;
    for (let k = 0; k < pts.length; k++) {
      const [x, z] = pts[k];
      const [px, pz] = pts[Math.max(0, k - 1)];
      const [nx, nz] = pts[Math.min(pts.length - 1, k + 1)];
      let dx = nx - px;
      let dz = nz - pz;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      if (k > 0) run += Math.hypot(x - px, z - pz);
      const y = Math.max(0, heightAt(tiles, x, z)) + 0.28;
      for (const sd of [-1, 1]) {
        pos.push(x, y, z);
        side.push(sd);
        dist.push(run);
        across.push(-dz, dx);
      }
      if (k < pts.length - 1) {
        const v = base + k * 2;
        index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    base += pts.length * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute("aDist", new THREE.Float32BufferAttribute(dist, 1));
  g.setAttribute("aAcross", new THREE.Float32BufferAttribute(across, 2));
  g.setIndex(index);
  return g;
}

function lineMaterial(color: string, dash: number) {
  return new THREE.ShaderMaterial({
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uDash: { value: dash },
      uOpacity: { value: 0 },
      uGlow: { value: 0 },
      uPx: { value: 0.0016 },
      uMinW: { value: 0.06 },
    },
    transparent: true,
    depthWrite: false,
  });
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();

/** Posts every few paces along the restricted line, with two strands of wire between. */
function fenceParts(tiles: Tile[], lines: Border[]) {
  const posts: THREE.Matrix4[] = [];
  const wires: THREE.Matrix4[] = [];
  const GAP = 1.6;
  for (const { pts, restricted } of lines) {
    if (!restricted) continue;
    let carry = 0;
    let prev: THREE.Vector3 | null = null;
    for (let k = 1; k < pts.length; k++) {
      const [ax, az] = pts[k - 1];
      const [bx, bz] = pts[k];
      const len = Math.hypot(bx - ax, bz - az);
      let t = GAP - carry;
      while (t <= len) {
        const x = ax + ((bx - ax) * t) / len;
        const z = az + ((bz - az) * t) / len;
        const y = Math.max(0, heightAt(tiles, x, z));
        const p = new THREE.Vector3(x, y, z);
        const lean = (hash(Math.round(x * 10), Math.round(z * 10)) - 0.5) * 0.08;
        tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean);
        posts.push(new THREE.Matrix4().compose(tmpP.set(x, y + 0.36, z), tmpQ, tmpS.set(1, 1, 1)));
        if (prev) {
          const mid = prev.clone().add(p).multiplyScalar(0.5);
          const dir = p.clone().sub(prev);
          const l = dir.length();
          const q = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(1, 0, 0),
            dir.normalize(),
          );
          for (const h of [0.3, 0.58])
            wires.push(
              new THREE.Matrix4().compose(
                new THREE.Vector3(mid.x, mid.y + h, mid.z),
                q,
                new THREE.Vector3(l, 1, 1),
              ),
            );
        }
        prev = p;
        t += GAP;
      }
      carry = len - (t - GAP);
    }
  }
  return { posts, wires };
}

export function Zones({ tiles, show }: { tiles: Tile[]; show: boolean }) {
  // Borders follow the regions, which never move: work them out once per island.
  const key = useMemo(() => tiles.map((t) => t.region[0]).join(""), [tiles]);
  const lines = useMemo(() => zoneBorders(tiles), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const plain = useMemo(
    () =>
      lineGeometry(
        tiles,
        lines.filter((l) => !l.restricted),
      ),
    [lines], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const red = useMemo(
    () =>
      lineGeometry(
        tiles,
        lines.filter((l) => l.restricted),
      ),
    [lines], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const plainMat = useMemo(() => lineMaterial("#f3e8cf", 1.4), []);
  const redMat = useMemo(() => lineMaterial("#ff5a3c", 0), []);
  const fence = useMemo(() => fenceParts(tiles, lines), [lines]); // eslint-disable-line react-hooks/exhaustive-deps
  const postRef = useRef<THREE.InstancedMesh>(null);
  const wireRef = useRef<THREE.InstancedMesh>(null);
  const fenceGroup = useRef<THREE.Group>(null);
  useEffect(
    () => () => {
      plain.dispose();
      red.dispose();
    },
    [plain, red],
  );
  useEffect(() => {
    postRef.current && fence.posts.forEach((m, k) => postRef.current!.setMatrixAt(k, m));
    wireRef.current && fence.wires.forEach((m, k) => wireRef.current!.setMatrixAt(k, m));
    if (postRef.current) postRef.current.instanceMatrix.needsUpdate = true;
    if (wireRef.current) wireRef.current.instanceMatrix.needsUpdate = true;
  }, [fence]);
  const want = useRef({ show });
  want.current.show = show;
  useFrame(() => {
    const b = env.blueprint;
    const vis = Math.max(want.current.show ? 0.7 : 0, b);
    plainMat.uniforms.uOpacity.value = vis * (0.75 + b * 0.25);
    redMat.uniforms.uOpacity.value = Math.max(want.current.show ? 0.85 : 0, b);
    (plainMat.uniforms.uColor.value as THREE.Color).set("#f3e8cf").lerp(CYAN, b);
    plainMat.uniforms.uGlow.value = b * 0.8;
    redMat.uniforms.uGlow.value = b * 0.8;
    // Thicker, and drawn over everything, on the flat map.
    plainMat.uniforms.uPx.value = 0.0012 + b * 0.0012;
    redMat.uniforms.uPx.value = 0.0018 + b * 0.0016;
    plainMat.depthTest = redMat.depthTest = b < 0.5;
    if (fenceGroup.current) fenceGroup.current.visible = b < 0.5;
  });
  return (
    <group>
      <mesh geometry={plain} material={plainMat} renderOrder={6} frustumCulled={false} />
      <mesh geometry={red} material={redMat} renderOrder={7} frustumCulled={false} />
      <group ref={fenceGroup}>
        <instancedMesh
          ref={postRef}
          args={[undefined, undefined, Math.max(1, fence.posts.length)]}
          castShadow
          frustumCulled={false}
        >
          <cylinderGeometry args={[0.035, 0.045, 0.72, 5]} />
          <meshStandardMaterial color="#4a3a2a" roughness={0.95} />
        </instancedMesh>
        <instancedMesh
          ref={wireRef}
          args={[undefined, undefined, Math.max(1, fence.wires.length)]}
          frustumCulled={false}
        >
          <boxGeometry args={[1, 0.012, 0.012]} />
          <meshStandardMaterial color="#6d6a63" roughness={0.6} metalness={0.4} />
        </instancedMesh>
      </group>
    </group>
  );
}

const CYAN = new THREE.Color("#6fe3ff");

/** A spot on the restricted line to hang its warning label on. */
export function restrictedMarker(tiles: Tile[]): { x: number; y: number; z: number } | null {
  const lines = zoneBorders(tiles).filter((l) => l.restricted);
  const longest = lines.sort((a, b) => b.pts.length - a.pts.length)[0];
  if (!longest) return null;
  const [x, z] = longest.pts[Math.floor(longest.pts.length / 2)];
  return { x, y: Math.max(0, heightAt(tiles, x, z)) + 1.6, z };
}
