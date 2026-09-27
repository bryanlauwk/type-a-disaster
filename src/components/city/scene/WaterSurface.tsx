import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GRID_SIZE, type Tile } from "@/lib/city/types";
import type { WorldBus } from "./common";
import { env } from "./env";
import { MAX_DEPTH, W, WaterField } from "./water";

const VERTEX = /* glsl */ `
uniform sampler2D uField;
uniform float uTime;
uniform float uMaxDepth;
uniform float uTexel;
varying float vDepth;
varying float vFoam;
varying vec3 vNormal2;
varying vec3 vWorld;
float depthAt(vec2 uv) { return texture2D(uField, uv).r * uMaxDepth; }
void main() {
  vec4 f = texture2D(uField, uv);
  float d = f.r * uMaxDepth;
  // Little running ripples on top of the flow.
  float ripple = (sin(position.x * 3.1 + uTime * 2.3) + sin(position.y * 2.7 - uTime * 1.9)) * 0.012;
  vec3 p = position;
  p.z = d > 0.004 ? d + 0.03 + ripple * min(1.0, d * 6.0) : -0.3;
  // Slope from the neighbouring cells, for lighting and foam.
  float dl = depthAt(uv - vec2(uTexel, 0.0));
  float dr = depthAt(uv + vec2(uTexel, 0.0));
  float dd = depthAt(uv - vec2(0.0, uTexel));
  float du = depthAt(uv + vec2(0.0, uTexel));
  vec3 n = normalize(vec3(dl - dr, du - dd, 1.0 * ${(GRID_SIZE / W).toFixed(3)} * 2.0));
  vNormal2 = normalize((modelMatrix * vec4(n, 0.0)).xyz);
  vDepth = d;
  vFoam = f.g * 0.9 + clamp(length(vec2(dl - dr, du - dd)) * 1.2, 0.0, 0.45);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uLight;
uniform vec3 uSun;
varying float vDepth;
varying float vFoam;
varying vec3 vNormal2;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  if (vDepth < 0.004) discard;
  // Muddy at the shallow edges, dark green-blue where it's deep.
  vec3 shallow = vec3(0.50, 0.52, 0.40);
  vec3 deep = vec3(0.13, 0.30, 0.34);
  vec3 col = mix(shallow, deep, smoothstep(0.02, 0.7, vDepth));
  // Wobble the normal so the surface catches the light.
  vec2 q = vWorld.xz * 2.2;
  vec3 n = normalize(vNormal2 + vec3(noise(q + uTime * 0.7) - 0.5, 0.0, noise(q.yx - uTime * 0.6) - 0.5) * 0.35);
  vec3 view = normalize(cameraPosition - vWorld);
  float diffuse = 0.55 + 0.45 * max(dot(n, uSun), 0.0);
  float fresnel = pow(1.0 - max(dot(n, view), 0.0), 3.0);
  float spec = pow(max(dot(reflect(-uSun, n), view), 0.0), 60.0);
  col = col * diffuse + vec3(0.55, 0.65, 0.72) * fresnel * 0.35;
  // Foam: churning white at the crest and where the water is thin.
  float edge = 1.0 - smoothstep(0.0, 0.03, vDepth);
  float churn = noise(vWorld.xz * 6.0 + vec2(uTime * 1.5, -uTime)) * 0.6 + noise(vWorld.xz * 14.0 - uTime * 2.0) * 0.4;
  float foam = smoothstep(0.5, 0.9, (vFoam + edge * 0.45) * (0.45 + churn));
  col = mix(col, vec3(0.93, 0.95, 0.94), foam);
  col = col * uLight + vec3(1.0) * spec * 0.5 * uLight;
  float alpha = smoothstep(0.004, 0.05, vDepth) * mix(0.78, 0.95, foam);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * The one water surface over the town: floods, tsunamis and flash floods are
 * all this same sheet, shaped by the shared water field.
 */
export function WaterSurface({ grid, bus }: { grid: Tile[]; bus: WorldBus }) {
  const field = useMemo(() => new WaterField(), []);
  useEffect(() => {
    bus.water = field;
    return () => {
      if (bus.water === field) bus.water = undefined;
    };
  }, [bus, field]);
  useEffect(() => field.setStanding(grid), [field, grid]);

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE, W * 2, W * 2);
    return g;
  }, []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uField: { value: field.texture },
          uTime: { value: 0 },
          uMaxDepth: { value: MAX_DEPTH },
          uTexel: { value: 1 / W },
          uLight: { value: 1 },
          uSun: { value: new THREE.Vector3(0.45, 0.8, 0.35).normalize() },
        },
        transparent: true,
        depthWrite: false,
      }),
    [field],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      field.texture.dispose();
    },
    [geometry, material, field],
  );

  useFrame(({ clock }, dt) => {
    field.step(Math.min(dt, 0.1), bus.surge);
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uLight.value = 0.25 + env.daylight * 0.8 + env.flash * 0.3;
  });

  // The plane lies flat; its local z is height. uv (0,0) is the map's
  // north-west corner, matching the field's row order.
  return (
    <mesh
      geometry={geometry}
      material={material}
      rotation-x={-Math.PI / 2}
      scale={[1, -1, 1]}
      frustumCulled={false}
      renderOrder={1}
    />
  );
}
