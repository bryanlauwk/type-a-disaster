import { useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import type { Actor, ActorShape } from "@/lib/city/types";
import { hash, type WorldBus } from "./common";
import { textureProps } from "./textures";

/** Seconds of aftermath after impact before a spectacle ends. */
export const AFTERMATH = 10;

export interface ActorProps {
  a: Actor;
  focus: { x: number; z: number };
  getT: () => number;
  impact: number;
  bus: WorldBus;
  seed: number;
  /** Heading in radians for travellers, matching the trail the sim wrecked. */
  heading?: number;
}

export const ease = (x: number) => Math.min(1, Math.max(0, x));

export function useSurfaceMap(url: string) {
  const texture = useLoader(THREE.TextureLoader, url);
  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
  }, [texture]);
  return texture;
}

export function useNormalMap(url: string) {
  const texture = useLoader(THREE.TextureLoader, url);
  useMemo(() => {
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
  }, [texture]);
  return texture;
}

export function Mat({
  color,
  emissive,
  opacity,
  map,
  normalMap,
  normalStrength = 0.35,
  roughness = 0.68,
  metalness = 0,
}: {
  color: string;
  emissive?: string;
  opacity?: number;
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  normalStrength?: number;
  roughness?: number;
  metalness?: number;
}) {
  return (
    <meshStandardMaterial
      color={color}
      {...textureProps(map, normalMap, normalStrength)}
      roughness={roughness}
      metalness={metalness}
      emissive={emissive ?? "#000000"}
      emissiveIntensity={emissive ? 1.2 : 0}
      transparent={opacity !== undefined}
      opacity={opacity ?? 1}
    />
  );
}

export function ShapeGeometry({ shape }: { shape: ActorShape }) {
  switch (shape) {
    case "box":
      return <boxGeometry args={[1, 1, 1]} />;
    case "cone":
      return <coneGeometry args={[0.55, 1.1, 8]} />;
    case "ring":
      return <torusGeometry args={[0.45, 0.16, 8, 16]} />;
    case "spiky":
      return <octahedronGeometry args={[0.6, 0]} />;
    case "sphere":
      return <sphereGeometry args={[0.5, 12, 10]} />;
    default:
      return <icosahedronGeometry args={[0.55, 1]} />;
  }
}

export function Faller({
  a,
  focus,
  getT,
  impact,
  children,
}: ActorProps & { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const s = 0.4 + a.size * 0.4;
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const t = getT();
    const k = ease(t / impact);
    if (t < impact) {
      g.position.set(focus.x + (1 - k) * 3, 26 * (1 - k * k) + s * 0.35, focus.z - (1 - k) * 2);
      g.rotation.set(Math.sin(t * 1.5) * 0.4, t * 0.8, Math.cos(t) * 0.2);
      g.scale.setScalar(s);
    } else {
      const since = t - impact;
      const squash = Math.exp(-since * 5) * Math.cos(since * 18) * 0.35;
      const sink = Math.max(0, since - 7) * 0.6;
      g.position.set(focus.x, s * 0.35 - sink, focus.z);
      g.rotation.set(0, impact * 0.8, 0);
      g.scale.set(s * (1 + squash * 0.5), s * (1 - squash), s * (1 + squash * 0.5));
    }
    if (shadow.current) {
      shadow.current.position.set(focus.x, 0.03, focus.z);
      shadow.current.scale.setScalar(s * (0.3 + k * 0.9));
      shadow.current.visible = t < impact + 7;
    }
  });
  return (
    <>
      <group ref={ref}>{children}</group>
      <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1, 16]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.3} />
      </mesh>
    </>
  );
}

export function Stomper({
  a,
  focus,
  getT,
  impact,
  bus,
  seed,
  heading,
  children,
}: ActorProps & { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const lastStep = useRef(0);
  const s = 0.3 + a.size * 0.3;
  const dir = useMemo(() => {
    const ang = heading ?? hash(seed, 7) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
  }, [seed, heading]);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const t = getT();
    const pause = 2.5;
    let off: number;
    if (t < impact) off = 16 * (1 - t / impact);
    else if (t < impact + pause) off = 0;
    else off = -16 * ((t - impact - pause) / (AFTERMATH - pause));
    const walking = t < impact || t > impact + pause;
    g.position.set(
      focus.x + dir.x * off,
      walking ? Math.abs(Math.sin(t * 4)) * 0.12 * s : 0,
      focus.z + dir.z * off,
    );
    g.rotation.y = Math.atan2(-dir.x, -dir.z);
    g.scale.setScalar(s * (walking ? 1 : 1 + Math.sin((t - impact) * 10) * 0.04));
    // Each footfall shakes the ground.
    const step = Math.floor((t * 4) / Math.PI);
    if (walking && step !== lastStep.current) {
      lastStep.current = step;
      bus.shake = Math.max(bus.shake, 0.03 * s);
    }
    g.userData.t = t;
  });
  return <group ref={ref}>{children}</group>;
}
