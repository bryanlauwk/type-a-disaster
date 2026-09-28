import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { env } from "./env";

/**
 * Dust kicked up by running animals: a pool of soft puffs, each born where a
 * foot came down, drifting and spreading as it fades. Anything can call
 * dustBus.emit; the pool reuses the oldest puff.
 */

const N = 320;

export const dustBus = {
  buf: new Float32Array(N * 4),
  born: new Float32Array(N).fill(-99),
  next: 0,
  dirty: false,
  now: 0,
  emit(x: number, y: number, z: number, size: number) {
    const k = this.next;
    this.next = (k + 1) % N;
    this.buf.set([x, y, z, size], k * 4);
    this.born[k] = this.now;
    this.dirty = true;
  },
};

const VERT = /* glsl */ `
attribute vec4 aPuff;
attribute float aBorn;
uniform float uNow;
varying vec2 vUv;
varying float vA;
void main() {
  float age = uNow - aBorn;
  float life = age / 1.8;
  float alive = step(0.0, life) * step(life, 1.0);
  vec3 c = aPuff.xyz + vec3(0.0, aPuff.w * (0.15 + life * 0.5), 0.0);
  float size = aPuff.w * (0.5 + sqrt(max(life, 0.0)) * 1.4) * alive;
  vec4 mv = viewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vA = alive * smoothstep(0.0, 0.1, life) * (1.0 - life);
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uLight;
varying vec2 vUv;
varying float vA;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.2, d) * vA * 0.45;
  if (a < 0.005) discard;
  gl_FragColor = vec4(uColor * uLight, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function DustPool() {
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute("position", plane.getAttribute("position"));
    g.setAttribute("uv", plane.getAttribute("uv"));
    g.setAttribute(
      "aPuff",
      new THREE.InstancedBufferAttribute(dustBus.buf, 4).setUsage(THREE.DynamicDrawUsage),
    );
    g.setAttribute(
      "aBorn",
      new THREE.InstancedBufferAttribute(dustBus.born, 1).setUsage(THREE.DynamicDrawUsage),
    );
    g.instanceCount = N;
    return g;
  }, []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uNow: { value: 0 },
          uColor: { value: new THREE.Color("#b9a98a") },
          uLight: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame(({ clock }) => {
    dustBus.now = clock.elapsedTime;
    material.uniforms.uNow.value = clock.elapsedTime;
    material.uniforms.uLight.value = 0.3 + env.daylight * 0.75;
    if (dustBus.dirty) {
      (geometry.getAttribute("aPuff") as THREE.InstancedBufferAttribute).needsUpdate = true;
      (geometry.getAttribute("aBorn") as THREE.InstancedBufferAttribute).needsUpdate = true;
      dustBus.dirty = false;
    }
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />;
}
