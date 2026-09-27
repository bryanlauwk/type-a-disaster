/**
 * Maple Hollow's actor & effect library: small-town life and the Upside Down
 * breaking through, which Claude can cast in an event. Each actor uses
 * deterministic procedural geometry and animated details.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GRID_SIZE } from "@/lib/city/types";
import { RAILROAD } from "@/lib/city/hollow";
import type { ActorKind } from "@/lib/city/types";
import { hash } from "./common";
import { AFTERMATH, Mat, ease, type ActorProps } from "./actorParts";
import { Looming, Spores } from "./UpsideDown";
import { Puffs } from "./vfx";

type LibraryKind = Extract<
  ActorKind,
  | "hot_air_balloon"
  | "parade"
  | "kids_on_bikes"
  | "black_vans"
  | "christmas_lights"
  | "rift"
  | "vines"
  | "spores"
  | "shadow"
  | "sinkhole"
  | "landslide"
  | "blackout"
  | "earthquake"
  | "aurora"
  | "phantom_train"
  | "radio_burst"
>;

/** Seconds after start when each library actor makes contact. */
export const LIBRARY_IMPACT: Record<LibraryKind, number> = {
  hot_air_balloon: 3.5,
  parade: 3,
  kids_on_bikes: 3.5,
  black_vans: 3.2,
  christmas_lights: 1.5,
  rift: 2.2,
  vines: 2.5,
  spores: 2,
  shadow: 4,
  sinkhole: 1.2,
  landslide: 2,
  blackout: 1,
  earthquake: 2.1,
  aurora: 2.8,
  phantom_train: 4,
  radio_burst: 2.4,
};

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** A unit direction for actors that walk through, varied per event. */
function useDir(seed: number, salt = 7) {
  return useMemo(() => {
    const ang = hash(seed, salt) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
  }, [seed, salt]);
}

/** Seeded procedural detail so a replay shows the same actor every time. */
const detail = (seed: number, index: number, salt = 0) => hash(seed * 104729 + index, salt);
function detailDirection(seed: number, index: number, salt = 0) {
  const y = detail(seed, index, salt) * 2 - 1;
  const angle = detail(seed, index, salt + 1) * Math.PI * 2;
  const ring = Math.sqrt(1 - y * y);
  return new THREE.Vector3(Math.cos(angle) * ring, y, Math.sin(angle) * ring);
}

// ---------------------------------------------------------------------------
// Set pieces
// ---------------------------------------------------------------------------

/** A striped hot-air balloon drifting in over the rooftops. */
function HotAirBalloon({ a, focus, getT, impact, seed }: ActorProps) {
  const ref = useRef<THREE.Group>(null);
  const dir = useDir(seed, 11);
  const s = 0.6 + a.size * 0.2;
  useFrame(() => {
    const t = getT();
    const g = ref.current;
    if (!g) return;
    const off = t < impact ? 14 * (1 - t / impact) : -(t - impact) * 1.2;
    g.position.set(focus.x + dir.x * off, 3.5 + s + Math.sin(t) * 0.15, focus.z + dir.z * off);
    g.rotation.y = t * 0.2;
    g.scale.setScalar(s);
  });
  const stripes = [a.color || "#e84a3c", "#f7d154", "#3aa0e8", "#ffffff"];
  return (
    <group ref={ref}>
      {Array.from({ length: 8 }, (_, k) => (
        <mesh key={k} castShadow rotation={[0, (k / 8) * Math.PI * 2, 0]}>
          <sphereGeometry args={[0.9, 6, 10, 0, Math.PI / 4, 0, Math.PI * 0.8]} />
          <Mat color={stripes[k % stripes.length]} />
        </mesh>
      ))}
      <mesh position={[0, -1.3, 0]}>
        <boxGeometry args={[0.3, 0.2, 0.3]} />
        <Mat color="#8a5a2b" />
      </mesh>
      {[-0.12, 0.12].map((x) => (
        <mesh key={x} position={[x, -1, 0]}>
          <cylinderGeometry args={[0.005, 0.005, 0.55, 3]} />
          <Mat color="#333333" />
        </mesh>
      ))}
    </group>
  );
}

/**
 * The homecoming parade: the Maple Hollow High marching band in red, white
 * and blue behind a harvest float with a giant pumpkin.
 */
function Parade({ a, focus, getT, impact, seed }: ActorProps) {
  const people = useRef<THREE.InstancedMesh>(null);
  const extras = useRef<THREE.InstancedMesh>(null);
  const lead = useRef<THREE.Group>(null);
  const dir = useDir(seed, 17);
  const n = Math.min(40, Math.max(12, Math.round(a.count) || 24));
  const palette = useMemo(
    () => [a.color && a.color !== "#888888" ? a.color : "#b22234", "#f4f4f4", "#1f3a6b"],
    [a.color],
  );
  useFrame(() => {
    const t = getT();
    const head = -8 + (16 * t) / (impact + AFTERMATH);
    const perp = new THREE.Vector3(dir.z, 0, -dir.x);
    for (let k = 0; k < n; k++) {
      const row = Math.floor(k / 3);
      const col = (k % 3) - 1;
      const d = head - row * 0.35;
      tmpP.set(
        focus.x + dir.x * d + perp.x * col * 0.25,
        0.1 + Math.abs(Math.sin(t * 5 + k)) * 0.03,
        focus.z + dir.z * d + perp.z * col * 0.25,
      );
      tmpM.compose(tmpP, tmpQ.identity(), tmpS.setScalar(1.4));
      people.current?.setMatrixAt(k, tmpM);
      people.current?.setColorAt(k, new THREE.Color(palette[k % palette.length]));
      // Brass instruments and batons catching the light.
      if (k % 2 === 0) {
        tmpP.y += 0.12;
        tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dir.x, dir.z));
        tmpM.compose(tmpP, tmpQ, tmpS.setScalar(1));
        extras.current?.setMatrixAt(k / 2, tmpM);
      }
    }
    for (const m of [people.current, extras.current]) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if (lead.current) {
      lead.current.position.set(focus.x + dir.x * (head + 0.8), 0, focus.z + dir.z * (head + 0.8));
      lead.current.rotation.y = Math.atan2(dir.x, dir.z);
    }
  });
  return (
    <>
      <instancedMesh ref={people} args={[undefined, undefined, n]} castShadow frustumCulled={false}>
        <capsuleGeometry args={[0.03, 0.07, 2, 5]} />
        <meshStandardMaterial roughness={0.86} />
      </instancedMesh>
      <instancedMesh
        ref={extras}
        args={[undefined, undefined, Math.ceil(n / 2)]}
        frustumCulled={false}
      >
        <torusGeometry args={[0.04, 0.012, 4, 10]} />
        <meshStandardMaterial color="#e1b12c" metalness={0.6} roughness={0.3} />
      </instancedMesh>
      <group ref={lead}>
        <mesh castShadow position={[0, 0.12, 0]}>
          <boxGeometry args={[0.5, 0.14, 0.9]} />
          <Mat color="#6b8f3a" />
        </mesh>
        <mesh castShadow position={[0, 0.42, 0]} scale={[1, 0.8, 1]}>
          <sphereGeometry args={[0.3, 16, 12]} />
          <Mat color="#e0701f" />
        </mesh>
        <mesh position={[0, 0.7, 0]}>
          <cylinderGeometry args={[0.03, 0.04, 0.1, 6]} />
          <Mat color="#4a6b2a" />
        </mesh>
        {[-0.2, 0.2].map((x) => (
          <mesh key={x} position={[x, 0.22, 0.45]}>
            <boxGeometry args={[0.12, 0.04, 0.02]} />
            <Mat color="#f4f4f4" />
          </mesh>
        ))}
      </group>
    </>
  );
}

// ---------------------------------------------------------------------------
// The Upside Down breaking through
// ---------------------------------------------------------------------------

/** A jagged, lens-shaped tear: the outline of a gate. */
function tearShape(seed: number, inset = 0): THREE.Shape {
  const pts: THREE.Vector2[] = [];
  const n = 28;
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * Math.PI * 2;
    const jag = 1 + (detail(seed, k, 83) - 0.5) * 0.35;
    const w = Math.sin(t) * 0.35 * (1 - inset) * jag;
    const h = Math.cos(t) * 1 * (1 - inset * 0.5);
    pts.push(new THREE.Vector2(w, h));
  }
  return new THREE.Shape(pts);
}

/** A gate tears open: a glowing red rip in the air, spores pouring out of it. */
function Rift({ a, focus, getT, impact, seed, bus }: ActorProps) {
  const group = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const membrane = useRef<THREE.Mesh>(null);
  const edge = useMemo(() => new THREE.ShapeGeometry(tearShape(seed)), [seed]);
  const core = useMemo(() => new THREE.ShapeGeometry(tearShape(seed, 0.25)), [seed]);
  const h = 0.8 + a.size * 0.25;
  const clock = useRef(0);
  const fired = useRef(false);
  useFrame((state) => {
    clock.current = state.clock.elapsedTime;
    const t = getT();
    if (!fired.current && t >= impact) {
      fired.current = true;
      bus.redStormUntil = bus.now + AFTERMATH + 6;
      bus.flash = 1;
    }
    const open = ease((t - impact * 0.4) / (impact * 0.6));
    const g = group.current;
    if (g) {
      g.scale.set(h * open * (1 + Math.sin(t * 5) * 0.03), h * Math.max(0.05, open), 1);
      g.position.set(focus.x, h * 1.05, focus.z);
      g.rotation.y = state.camera.rotation.y;
    }
    if (light.current)
      light.current.intensity = open * (6 + Math.sin(t * 7) * 2) * (1 + a.size * 0.2);
    membrane.current?.scale.setScalar(0.01 + open * (0.6 + a.size * 0.15));
  });
  const now = () => clock.current + seed;
  return (
    <>
      <group ref={group}>
        <mesh geometry={edge}>
          <meshBasicMaterial
            color="#ff3a22"
            toneMapped={false}
            side={THREE.DoubleSide}
            transparent
            opacity={0.95}
          />
        </mesh>
        <mesh geometry={core} position={[0, 0, 0.001]}>
          <meshBasicMaterial color="#12040a" side={THREE.DoubleSide} />
        </mesh>
      </group>
      {/* The ground around the gate goes soft and veined */}
      <mesh ref={membrane} position={[focus.x, 0.02, focus.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1, 24]} />
        <meshStandardMaterial color="#3b1a1f" emissive="#5a0e12" emissiveIntensity={0.6} />
      </mesh>
      <pointLight ref={light} position={[focus.x, h, focus.z]} color="#ff3322" distance={10} />
      <Puffs
        getT={() => (getT() > impact * 0.5 ? now() : -1)}
        origin={[focus.x, h, focus.z]}
        count={70}
        duration={4}
        spread={1.2}
        rise={2.5}
        size={[0.15, 0.35]}
        color="#d9dde6"
        opacity={0.6}
        loop
        seed={seed}
      />
    </>
  );
}

/** Tendrils growing out from the focus across the ground and up the walls. */
function VinesActor({ a, focus, getT, impact, seed }: ActorProps) {
  const reach = 1.2 + a.size * 0.5;
  const tubes = useMemo(
    () =>
      Array.from({ length: 22 }, (_, k) => {
        const ang = (k / 22) * Math.PI * 2 + detail(seed, k, 101) * 0.4;
        const len = reach * (0.5 + detail(seed, k, 103) * 0.6);
        const climb = detail(seed, k, 107) < 0.3;
        const pts: THREE.Vector3[] = [];
        for (let s = 0; s <= 8; s++) {
          const d = (s / 8) * len;
          const wob = Math.sin(s * 1.3 + k) * 0.25;
          pts.push(
            new THREE.Vector3(
              Math.cos(ang) * d + Math.sin(ang) * wob,
              climb && s > 5 ? (s - 5) * 0.18 : 0.02,
              Math.sin(ang) * d - Math.cos(ang) * wob,
            ),
          );
        }
        const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.035, 5, false);
        return { g, lag: detail(seed, k, 109) * 0.8, total: g.index ? g.index.count : 0 };
      }),
    [reach, seed],
  );
  useEffect(() => () => tubes.forEach((tb) => tb.g.dispose()), [tubes]);
  useFrame(() => {
    const t = getT();
    for (const tb of tubes) {
      const grow = ease((t - impact * 0.3 - tb.lag) / (impact * 0.9));
      tb.g.setDrawRange(0, Math.floor((tb.total * grow) / 6) * 6);
    }
  });
  return (
    <group position={[focus.x, 0, focus.z]}>
      {tubes.map((tb, k) => (
        <mesh key={k} geometry={tb.g} castShadow>
          <meshStandardMaterial
            color={a.color && a.color !== "#888888" ? a.color : "#3b1f22"}
            emissive="#5a0e12"
            emissiveIntensity={0.5}
            roughness={0.6}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Spores drift up everywhere; the air turns grey and thick. */
function SporeStorm({ getT, bus, impact }: ActorProps) {
  const fired = useRef(false);
  useFrame(() => {
    if (!fired.current && getT() >= impact * 0.5) {
      fired.current = true;
      bus.hazeUntil = bus.now + AFTERMATH + 20;
    }
  });
  return <Spores count={1400} half={16} height={8} />;
}

/**
 * The shadow: something colossal rises over the horizon behind the focus and
 * stands there in the storm, lit by red lightning.
 */
function Shadow({ focus, getT, impact, bus, seed }: ActorProps) {
  const dir = useDir(seed, 23);
  const fired = useRef(false);
  useFrame(() => {
    if (!fired.current && getT() >= impact) {
      fired.current = true;
      bus.redStormUntil = bus.now + AFTERMATH + 12;
      bus.flash = 1;
    }
  });
  const pos: [number, number, number] = [focus.x + dir.x * 22, 0, focus.z + dir.z * 22];
  return <Looming position={pos} getRise={() => ease(getT() / (impact + 1.5))} />;
}

// ---------------------------------------------------------------------------
// Small-town life
// ---------------------------------------------------------------------------

const KID_COLORS = ["#e84393", "#1b998b", "#f18f01", "#d7263d", "#2e86ab", "#ffbe0b"];

/** A gang of kids on BMX bikes pedalling in, flashlights on. */
function KidsOnBikes({ a, focus, getT, impact, seed }: ActorProps) {
  const riders = useRef<THREE.Group>(null);
  const dir = useDir(seed, 29);
  const n = Math.min(6, Math.max(3, Math.round(a.count) || 4));
  useFrame(() => {
    const t = getT();
    const perp = new THREE.Vector3(dir.z, 0, -dir.x);
    riders.current?.children.forEach((r, k) => {
      const row = k - (n - 1) / 2;
      // Ride in, then pull up in a half-circle around the focus.
      const d = t < impact ? 9 * (1 - t / impact) + 0.9 : 0.9;
      const lateral = row * (t < impact ? 0.35 : 0.5);
      r.position.set(
        focus.x + dir.x * d + perp.x * lateral,
        0,
        focus.z + dir.z * d + perp.z * lateral,
      );
      r.rotation.y = Math.atan2(-dir.x, -dir.z);
      const wheel = r.children[0];
      if (wheel && t < impact) wheel.rotation.x = -t * 12;
      r.position.y = t < impact ? Math.abs(Math.sin(t * 9 + k)) * 0.01 : 0;
    });
  });
  return (
    <group ref={riders}>
      {Array.from({ length: n }, (_, k) => {
        const c = KID_COLORS[(k + Math.floor(detail(seed, k, 113) * 6)) % KID_COLORS.length];
        return (
          <group key={k} scale={1.6}>
            <group>
              {[-0.07, 0.07].map((z) => (
                <mesh key={z} position={[0, 0.045, z]} rotation={[0, Math.PI / 2, 0]}>
                  <torusGeometry args={[0.04, 0.008, 5, 12]} />
                  <meshStandardMaterial color="#1a1a1a" />
                </mesh>
              ))}
            </group>
            <mesh position={[0, 0.07, 0]}>
              <boxGeometry args={[0.012, 0.012, 0.14]} />
              <Mat color={c} />
            </mesh>
            <mesh castShadow position={[0, 0.15, -0.01]}>
              <capsuleGeometry args={[0.025, 0.06, 2, 6]} />
              <Mat color={c} />
            </mesh>
            <mesh position={[0, 0.21, -0.005]}>
              <sphereGeometry args={[0.022, 8, 6]} />
              <Mat color={["#f0c6a0", "#d7a47b", "#b77c58"][k % 3]} />
            </mesh>
            <mesh position={[0, 0.16, -0.04]}>
              <boxGeometry args={[0.035, 0.04, 0.02]} />
              <Mat color="#6a4a2f" />
            </mesh>
            {/* Flashlight beam */}
            <mesh position={[0, 0.12, 0.2]} rotation={[Math.PI / 2 + 0.25, 0, 0]}>
              <coneGeometry args={[0.07, 0.34, 10, 1, true]} />
              <meshBasicMaterial
                color="#fff4c8"
                transparent
                opacity={0.22}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/**
 * The lab turns up: black vans drive in and park, and men in hazmat suits fan
 * out around the focus. (More vans arrive by road; see the convoy handling in
 * Spectacle.)
 */
function Agents({ focus, getT, impact, seed }: ActorProps) {
  const suits = useRef<THREE.InstancedMesh>(null);
  const vans = useRef<THREE.Group>(null);
  const dir = useDir(seed, 31);
  const n = 10;
  useFrame(() => {
    const t = getT();
    const perp = new THREE.Vector3(dir.z, 0, -dir.x);
    vans.current?.children.forEach((v, k) => {
      const d = (t < impact ? 10 * (1 - t / impact) : 0) + 1.3 + k * 0.2;
      const side = k ? 0.5 : -0.5;
      v.position.set(focus.x + dir.x * d + perp.x * side, 0, focus.z + dir.z * d + perp.z * side);
      v.rotation.y = Math.atan2(-dir.x, -dir.z);
    });
    const m = suits.current;
    if (!m) return;
    const out = ease((t - impact) / 3);
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2 + detail(seed, k, 127);
      const r = 0.5 + out * (0.8 + detail(seed, k, 131) * 0.8);
      tmpP.set(
        focus.x + Math.cos(ang) * r,
        t < impact ? -2 : 0.12 + Math.abs(Math.sin(t * 6 + k)) * 0.01,
        focus.z + Math.sin(ang) * r,
      );
      tmpM.compose(tmpP, tmpQ.identity(), tmpS.setScalar(2));
      m.setMatrixAt(k, tmpM);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <group ref={vans}>
        {[0, 1].map((k) => (
          <group key={k}>
            <mesh castShadow position={[0, 0.16, 0]}>
              <boxGeometry args={[0.26, 0.24, 0.5]} />
              <meshStandardMaterial color="#121316" roughness={0.35} metalness={0.4} />
            </mesh>
            <mesh position={[0, 0.2, 0.251]}>
              <boxGeometry args={[0.22, 0.08, 0.004]} />
              <meshStandardMaterial color="#1c232b" roughness={0.1} />
            </mesh>
            <mesh position={[0, 0.3, -0.1]}>
              <cylinderGeometry args={[0.06, 0.06, 0.012, 12]} />
              <meshStandardMaterial color="#d8d8d4" />
            </mesh>
          </group>
        ))}
      </group>
      <instancedMesh ref={suits} args={[undefined, undefined, n]} castShadow frustumCulled={false}>
        <capsuleGeometry args={[0.035, 0.07, 3, 6]} />
        <meshStandardMaterial color="#e8e4c8" roughness={0.5} />
      </instancedMesh>
    </>
  );
}

/**
 * Christmas lights strung along the houses, blinking one bulb at a time as
 * if someone were spelling something out.
 */
function ChristmasLights({ focus, getT, impact, seed }: ActorProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const colors = ["#ff3b30", "#2ecc71", "#3498db", "#f1c40f", "#e84393", "#ff9f1a"];
  const bulbs = useMemo(
    () =>
      Array.from({ length: 78 }, (_, k) => {
        const row = Math.floor(k / 26);
        const col = k % 26;
        return {
          x: focus.x - 2.6 + col * 0.2,
          y: 0.35 + row * 0.18 - Math.abs(Math.sin(col * 0.9)) * 0.05,
          z: focus.z - 0.6 + row * 0.6,
          c: new THREE.Color(colors[(k + Math.floor(detail(seed, k, 137) * 6)) % colors.length]),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focus, seed],
  );
  const lit = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const t = getT();
    const m = ref.current;
    if (!m) return;
    const on = ease((t - impact * 0.5) / 1.2);
    // After impact, one bulb at a time flares, hopping along the string.
    const spell = t > impact ? Math.floor((t - impact) * 2.5) : -1;
    const target = spell >= 0 ? Math.floor(detail(seed, spell, 139) * bulbs.length) : -1;
    bulbs.forEach((b, k) => {
      tmpP.set(b.x, b.y, b.z);
      tmpM.compose(tmpP, tmpQ.identity(), tmpS.setScalar(on * (k === target ? 1.8 : 1)));
      m.setMatrixAt(k, tmpM);
      const flick = t > impact ? (k === target ? 3 : 0.35) : 1.2;
      m.setColorAt(k, lit.copy(b.c).multiplyScalar(flick));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, bulbs.length]} frustumCulled={false}>
      <sphereGeometry args={[0.035, 8, 6]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// Mishaps
// ---------------------------------------------------------------------------

/** The road caves in: a dark pit opens and debris tumbles in. */
function Sinkhole({ a, focus, getT, impact, seed }: ActorProps) {
  const pit = useRef<THREE.Mesh>(null);
  const bits = useRef<THREE.InstancedMesh>(null);
  const r = 0.5 + a.size * 0.18;
  const chunks = useMemo(
    () =>
      Array.from({ length: 24 }, (_, k) => ({
        a: detail(seed, k, 53) * Math.PI * 2,
        d: detail(seed, k, 59),
        s: 0.05 + detail(seed, k, 61) * 0.1,
      })),
    [seed],
  );
  useFrame(() => {
    const t = getT();
    const open = ease((t - impact * 0.6) / 1.2);
    pit.current?.scale.set(r * open + 0.001, 1, r * open + 0.001);
    const m = bits.current;
    if (!m) return;
    chunks.forEach((c, k) => {
      const lt = t - impact - c.d * 2;
      const rr = r * open * (0.4 + c.d * 0.6);
      const y = lt > 0 ? 0.05 - lt * lt * 2 : 0.05;
      tmpP.set(focus.x + Math.cos(c.a) * rr, y, focus.z + Math.sin(c.a) * rr);
      tmpM.compose(
        tmpP,
        tmpQ.setFromEuler(new THREE.Euler(lt, lt * 2, 0)),
        tmpS.setScalar(y > -1 ? c.s : 0),
      );
      m.setMatrixAt(k, tmpM);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <mesh ref={pit} position={[focus.x, 0.03, focus.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1, 18]} />
        <meshBasicMaterial color="#0b0906" />
      </mesh>
      <instancedMesh ref={bits} args={[undefined, undefined, chunks.length]} frustumCulled={false}>
        <boxGeometry args={[1, 0.4, 1]} />
        <meshStandardMaterial color="#4a4a4e" roughness={0.92} />
      </instancedMesh>
    </>
  );
}

/** Mud and trees slide down the slope towards the focus. */
function Landslide({ a, focus, getT, impact, seed }: ActorProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dir = useDir(seed, 19);
  const clods = useMemo(
    () =>
      Array.from({ length: 40 }, (_, k) => ({
        side: (detail(seed, k, 67) - 0.5) * (1.5 + a.size * 0.3),
        lag: detail(seed, k, 71) * 1.2,
        s: 0.15 + detail(seed, k, 73) * 0.25,
        tree: detail(seed, k, 79) < 0.2,
      })),
    [a.size, seed],
  );
  useFrame(() => {
    const t = getT();
    const m = ref.current;
    if (!m) return;
    const perp = new THREE.Vector3(dir.z, 0, -dir.x);
    clods.forEach((c, k) => {
      const lt = Math.max(0, t - c.lag * 0.5);
      const d = 5 - Math.min(5.5, lt * (5 / impact));
      tmpP.set(
        focus.x + dir.x * d + perp.x * c.side,
        Math.max(0.05, d * 0.35) + c.s / 2,
        focus.z + dir.z * d + perp.z * c.side,
      );
      tmpM.compose(
        tmpP,
        tmpQ.setFromEuler(new THREE.Euler(lt * 2, lt, 0)),
        tmpS.set(c.s, c.s * 0.7, c.s),
      );
      m.setMatrixAt(k, tmpM);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, clods.length]}
      castShadow
      frustumCulled={false}
    >
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#6b4a2b" roughness={0.94} />
    </instancedMesh>
  );
}

/** A substation blows: blue flash, sparks, and the lights go out. */
function Blackout({ focus, getT, impact, bus }: ActorProps) {
  const sparks = useRef<THREE.Group>(null);
  const fired = useRef(false);
  useFrame(() => {
    const t = getT();
    if (!fired.current && t >= impact) {
      fired.current = true;
      bus.blackoutUntil = bus.now + AFTERMATH + 20;
      bus.flash = 1;
    }
    sparks.current?.children.forEach((c, i) => {
      const on = t > impact && t < impact + 3 && Math.sin(t * 40 + i * 3) > 0.3;
      c.visible = on;
      c.position.set(
        Math.sin(i * 2.1) * 0.3,
        0.5 + Math.cos(i * 1.3) * 0.2,
        Math.cos(i * 2.1) * 0.3,
      );
    });
  });
  return (
    <group position={[focus.x, 0, focus.z]}>
      <mesh castShadow position={[0, 0.25, 0]}>
        <boxGeometry args={[0.5, 0.5, 0.4]} />
        <Mat color="#8b8f94" />
      </mesh>
      <group ref={sparks}>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh key={i}>
            <octahedronGeometry args={[0.06, 0]} />
            <meshBasicMaterial color="#9fe3ff" />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** A rolling fault line: shock rings race out and asphalt chunks kick upward. */
function Earthquake({ a, focus, getT, impact, seed, bus }: ActorProps) {
  const rings = useRef<THREE.Group>(null);
  const shook = useRef(false);
  const debris = useRef<THREE.InstancedMesh>(null);
  const chunks = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        angle: detail(seed, i, 211) * Math.PI * 2,
        delay: detail(seed, i, 223) * 1.1,
        speed: 1.4 + detail(seed, i, 227) * 2.2,
        size: 0.06 + detail(seed, i, 229) * 0.14,
      })),
    [seed],
  );
  useFrame(() => {
    const t = getT();
    const since = t - impact;
    // A foreshock, then the main quake shakes every building near it.
    if (!shook.current && t >= impact * 0.6) {
      shook.current = true;
      bus.quake = { x: focus.x, z: focus.z, amp: 0.8 + a.size * 0.12, until: bus.now + 5.5 };
    }
    if (since > 0 && since < 4) bus.shake = Math.max(bus.shake, 0.06 + a.size * 0.012);
    rings.current?.children.forEach((ring, i) => {
      const age = since - i * 0.52;
      ring.visible = age >= 0 && age < 3.2;
      if (age < 0) return;
      const progress = Math.min(1, age / 3.2);
      ring.scale.setScalar(0.3 + progress * (2.2 + a.size * 0.48));
      const material = (ring as THREE.Mesh).material as THREE.MeshBasicMaterial;
      material.opacity = (1 - progress) * 0.78;
    });
    const mesh = debris.current;
    if (!mesh) return;
    chunks.forEach((chunk, i) => {
      const age = since - chunk.delay;
      if (age < 0 || age > 2.4) {
        mesh.setMatrixAt(i, HIDDEN);
        return;
      }
      const distance = 0.4 + age * chunk.speed;
      const y = Math.max(0.04, 0.08 + age * (2 + a.size * 0.18) - age * age * 2.4);
      tmpP.set(
        focus.x + Math.cos(chunk.angle) * distance,
        y,
        focus.z + Math.sin(chunk.angle) * distance,
      );
      tmpQ.setFromEuler(new THREE.Euler(age * 3, age * 4, age * 2));
      tmpM.compose(tmpP, tmpQ, tmpS.setScalar(chunk.size * Math.max(0, 1 - age / 2.4)));
      mesh.setMatrixAt(i, tmpM);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <group ref={rings}>
        {[0, 1, 2].map((i) => (
          <mesh
            key={i}
            position={[focus.x, 0.06 + i * 0.012, focus.z]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <ringGeometry args={[0.9, 1, 48]} />
            <meshBasicMaterial
              color={i === 1 ? "#f0bd72" : "#c9a98a"}
              transparent
              opacity={0.7}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      </group>
      <instancedMesh
        ref={debris}
        args={[undefined, undefined, chunks.length]}
        castShadow
        frustumCulled={false}
      >
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#77716a" roughness={0.96} />
      </instancedMesh>
    </>
  );
}

/** Three luminous curtains ripple above town, turning a strange sky into a set piece. */
function Aurora({ focus, getT, impact, seed }: ActorProps) {
  const curtains = useRef<THREE.Group>(null);
  const colors = ["#74ffd2", "#78a7ff", "#d88bff"];
  useFrame((state) => {
    const t = getT();
    curtains.current?.children.forEach((curtain, band) => {
      const mesh = curtain as THREE.Mesh;
      const geometry = mesh.geometry as THREE.PlaneGeometry;
      const positions = geometry.attributes.position as THREE.BufferAttribute;
      const columns = 49;
      for (let i = 0; i < positions.count; i++) {
        const col = i % columns;
        const row = Math.floor(i / columns);
        const x = positions.getX(i);
        const rowOffset = (row / 4 - 0.5) * 2.4;
        positions.setY(
          i,
          rowOffset +
            Math.sin(x * 0.42 + t * (0.8 + band * 0.16) + band * 1.7) * 0.6 +
            Math.sin(x * 0.15 - t * 0.7 + seed * 0.00001) * 0.4,
        );
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      curtain.rotation.z = Math.sin(state.clock.elapsedTime * 0.12 + band) * 0.035;
      curtain.position.y = 11 + band * 0.8 + Math.sin(t * 0.4 + band) * 0.25;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.min(0.68, Math.max(0, (t - impact * 0.25) * 0.28));
    });
  });
  return (
    <group ref={curtains} position={[focus.x, 0, focus.z]}>
      {colors.map((color, i) => (
        <mesh key={color} position={[0, 11 + i * 0.8, (i - 1) * 0.7]}>
          <planeGeometry args={[25, 3, 48, 4]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** A pale freight train crosses the real railroad, briefly holding back its ordinary counterpart. */
function PhantomTrain({ getT, impact, bus }: ActorProps) {
  const train = useRef<THREE.Group>(null);
  const headlight = useRef<THREE.PointLight>(null);
  const stopped = useRef(false);
  const railZ = RAILROAD.row - (GRID_SIZE - 1) / 2;
  useFrame(() => {
    const t = getT();
    const headX = -18 + t * (18 / impact);
    if (train.current) {
      train.current.position.set(headX, 0, railZ);
      train.current.visible = t < impact + 5;
      train.current.children.forEach((car, i) => {
        car.position.x = -i * 1.5;
        const pulse = 0.7 + Math.sin(t * 3 + i * 0.7) * 0.16;
        car.traverse((node) => {
          if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshBasicMaterial)
            node.material.opacity = pulse;
        });
      });
    }
    if (headlight.current) headlight.current.intensity = 2 + Math.sin(t * 8) * 0.8;
    if (!stopped.current && t >= impact) {
      stopped.current = true;
      bus.railStopUntil = Math.max(bus.railStopUntil, bus.now + 5);
    }
  });
  return (
    <group ref={train} rotation={[0, Math.PI / 2, 0]}>
      {Array.from({ length: 7 }, (_, i) => (
        <group key={i}>
          <mesh castShadow position={[0, 0.48, 0]}>
            <boxGeometry args={[0.92, 0.72, 1.34]} />
            <meshBasicMaterial color={i === 0 ? "#e5f4ff" : "#a9c8d7"} transparent opacity={0.75} />
          </mesh>
          <mesh position={[0, 0.91, 0]}>
            <boxGeometry args={[0.94, 0.1, 1.38]} />
            <meshBasicMaterial color="#d8e7ef" transparent opacity={0.52} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.47, 0.49, 0.1]}>
              <boxGeometry args={[0.025, 0.2, 0.22]} />
              <meshBasicMaterial color="#b9f8ff" transparent opacity={0.92} />
            </mesh>
          ))}
        </group>
      ))}
      <pointLight
        ref={headlight}
        position={[0, 0.8, 0]}
        color="#c6fbff"
        distance={9}
        intensity={2}
      />
    </group>
  );
}

/** Radio static made visible: antenna sparks and concentric waves passing over rooftops. */
function RadioBurst({ a, focus, getT, impact, seed }: ActorProps) {
  const rings = useRef<THREE.Group>(null);
  const sparks = useRef<THREE.InstancedMesh>(null);
  const points = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        angle: detail(seed, i, 241) * Math.PI * 2,
        height: 0.25 + detail(seed, i, 251) * 1.4,
        size: 0.035 + detail(seed, i, 257) * 0.06,
        delay: detail(seed, i, 263) * 1.4,
      })),
    [seed],
  );
  useFrame(() => {
    const t = getT();
    rings.current?.children.forEach((ring, i) => {
      const age = t - impact + i * 0.55;
      ring.visible = age >= 0 && age < 3.4;
      if (age < 0) return;
      ring.scale.setScalar(0.1 + age * (0.95 + a.size * 0.14));
      (ring as THREE.Mesh).material &&
        (((ring as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = Math.max(
          0,
          0.8 * (1 - age / 3.4),
        ));
    });
    const mesh = sparks.current;
    if (!mesh) return;
    points.forEach((point, i) => {
      const age = t - impact - point.delay;
      if (age < 0 || age > 2.6) {
        mesh.setMatrixAt(i, HIDDEN);
        return;
      }
      const radius = 0.3 + age * (1.1 + a.size * 0.2);
      tmpP.set(
        focus.x + Math.cos(point.angle) * radius,
        point.height + Math.sin(age * 9 + i) * 0.12,
        focus.z + Math.sin(point.angle) * radius,
      );
      tmpM.compose(tmpP, tmpQ.identity(), tmpS.setScalar(point.size * (1 - age / 2.6)));
      mesh.setMatrixAt(i, tmpM);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <group ref={rings}>
        {[0, 1, 2, 3].map((i) => (
          <mesh
            key={i}
            position={[focus.x, 2.4 + i * 0.45, focus.z]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <torusGeometry args={[1, 0.025, 6, 48]} />
            <meshBasicMaterial
              color={i % 2 ? "#93f4ff" : "#e3c9ff"}
              transparent
              opacity={0.65}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
      <mesh position={[focus.x, 0.65, focus.z]}>
        <cylinderGeometry args={[0.045, 0.07, 1.3, 8]} />
        <meshStandardMaterial color="#55585b" metalness={0.55} roughness={0.45} />
      </mesh>
      <instancedMesh
        ref={sparks}
        args={[undefined, undefined, points.length]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#b8fbff" toneMapped={false} />
      </instancedMesh>
    </>
  );
}

// ---------------------------------------------------------------------------

export const ACTOR_LIBRARY: Record<LibraryKind, (p: ActorProps) => React.ReactNode> = {
  hot_air_balloon: HotAirBalloon,
  parade: Parade,
  kids_on_bikes: KidsOnBikes,
  black_vans: Agents,
  christmas_lights: ChristmasLights,
  rift: Rift,
  vines: VinesActor,
  spores: SporeStorm,
  shadow: Shadow,
  sinkhole: Sinkhole,
  landslide: Landslide,
  blackout: Blackout,
  earthquake: Earthquake,
  aurora: Aurora,
  phantom_train: PhantomTrain,
  radio_burst: RadioBurst,
};
