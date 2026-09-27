import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { hash } from "@/lib/island/rng";
import { env } from "./env";

/**
 * Soft particle effects — billowing dust, smoke, fireballs and spray — drawn
 * as camera-facing sprites entirely on the GPU: one draw call per effect,
 * with no per-frame JavaScript beyond a clock.
 */

let sprite: THREE.Texture | null = null;

/** A soft, lumpy puff, drawn once on a canvas. */
function puffTexture(): THREE.Texture {
  if (sprite) return sprite;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  // Several overlapping soft blobs give an irregular, cloud-like edge.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + hash(i, 5) * 0.8;
    const r = i === 0 ? 0 : size * (0.1 + hash(i, 7) * 0.12);
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r;
    const rad = size * (i === 0 ? 0.42 : 0.2 + hash(i, 9) * 0.14);
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, "rgba(255,255,255,0.55)");
    grad.addColorStop(0.55, "rgba(255,255,255,0.22)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  sprite = new THREE.CanvasTexture(canvas);
  sprite.colorSpace = THREE.NoColorSpace;
  return sprite;
}

const VERTEX = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uDuration;
uniform float uLoop;
uniform vec3 uOrigin;
uniform float uSpread;
uniform float uRise;
uniform float uFall;
uniform float uSize0;
uniform float uSize1;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
void main() {
  float life = (uTime - aSeed.z) / (uDuration * (0.7 + aSeed.w * 0.6));
  if (uLoop > 0.5) life = fract(life);
  float alive = step(0.0, life) * step(life, 1.0);
  float ang = aSeed.x * 6.28318;
  vec3 dir = vec3(cos(ang), 0.0, sin(ang));
  float outward = 1.0 - exp(-3.0 * life);
  vec3 centre = uOrigin
    + dir * uSpread * outward * (0.35 + aSeed.y * 0.9)
    + vec3(0.0, uRise * life * (0.5 + aSeed.w) - uFall * life * life, 0.0);
  float size = mix(uSize0, uSize1, sqrt(life)) * (0.7 + aSeed.y * 0.6) * alive;
  vec4 mv = modelViewMatrix * vec4(centre, 1.0);
  float spin = ang + life * (aSeed.y - 0.5) * 2.0;
  vec2 c = position.xy;
  mv.xy += vec2(c.x * cos(spin) - c.y * sin(spin), c.x * sin(spin) + c.y * cos(spin)) * size;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vAlpha = alive * smoothstep(0.0, 0.07, life) * pow(1.0 - life, 1.3);
  vShade = position.y + 0.5;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uLight;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
void main() {
  float a = texture2D(uMap, vUv).a * vAlpha * uOpacity;
  if (a < 0.004) discard;
  // Lit from above: puffs are brighter on top, darker underneath.
  vec3 col = uColor * mix(0.62, 1.12, vShade) * uLight;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface PuffsProps {
  /** Seconds on the effect's clock; negative before it starts. */
  getT: () => number;
  origin: [number, number, number];
  count: number;
  /** Seconds each puff lives (jittered ±30%). */
  duration: number;
  /** Puffs start over this many seconds. */
  stagger?: number;
  spread: number;
  rise: number;
  /** Gravity pulling puffs back down (spray). */
  fall?: number;
  size: [number, number];
  color: string;
  opacity?: number;
  /** Glowing effects (fire) add light instead of covering. */
  additive?: boolean;
  /** Keep emitting forever (a burning building's smoke). */
  loop?: boolean;
  seed?: number;
}

export function Puffs({
  getT,
  origin,
  count,
  duration,
  stagger = 0.4,
  spread,
  rise,
  fall = 0,
  size,
  color,
  opacity = 1,
  additive = false,
  loop = false,
  seed = 1,
}: PuffsProps) {
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute("position", plane.getAttribute("position"));
    g.setAttribute("uv", plane.getAttribute("uv"));
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seeds[i * 4] = hash(seed, i * 4 + 1);
      seeds[i * 4 + 1] = hash(seed, i * 4 + 2);
      seeds[i * 4 + 2] = loop ? hash(seed, i * 4 + 3) * duration : hash(seed, i * 4 + 3) * stagger;
      seeds[i * 4 + 3] = hash(seed, i * 4 + 4);
    }
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = count;
    return g;
  }, [count, seed, loop, duration, stagger]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uMap: { value: puffTexture() },
          uTime: { value: -1 },
          uDuration: { value: duration },
          uLoop: { value: loop ? 1 : 0 },
          uOrigin: { value: new THREE.Vector3(...origin) },
          uSpread: { value: spread },
          uRise: { value: rise },
          uFall: { value: fall },
          uSize0: { value: size[0] },
          uSize1: { value: size[1] },
          uColor: { value: new THREE.Color(color) },
          uOpacity: { value: opacity },
          uLight: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    // Uniforms that change are updated below; the rest are fixed per effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [additive],
  );
  useEffect(() => {
    const u = material.uniforms;
    u.uDuration.value = duration;
    u.uLoop.value = loop ? 1 : 0;
    (u.uOrigin.value as THREE.Vector3).set(...origin);
    u.uSpread.value = spread;
    u.uRise.value = rise;
    u.uFall.value = fall;
    u.uSize0.value = size[0];
    u.uSize1.value = size[1];
    (u.uColor.value as THREE.Color).set(color);
    u.uOpacity.value = opacity;
  }, [material, duration, loop, origin, spread, rise, fall, size, color, opacity]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(() => {
    material.uniforms.uTime.value = getT();
    // Smoke and dust darken at night; fire keeps its own light.
    material.uniforms.uLight.value = additive ? 1 : 0.3 + env.daylight * 0.75 + env.flash * 0.4;
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />;
}
