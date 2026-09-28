import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { HALF, LAKE, RIVER, SEA, SIZE, type Tile } from "@/lib/island/types";
import { around } from "@/lib/island/terrain";
import { heightAt, tileAtWorld, tileColor } from "./palette";
import { groundMaterial, groundUniforms, loadGround, tileGround } from "./ground";
import { env } from "./fx/env";

/** Vertices per tile along each side. */
const RES = 2;
const N = SIZE * RES + 1;

/** Grain and dappling on top of the tile colours, so the ground doesn't look flat-filled. */
function detailed(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPos;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vWorldPos;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float grain = vnoise(vWorldPos.xz * 2.3) * 0.6 + vnoise(vWorldPos.xz * 9.0) * 0.4;
diffuseColor.rgb *= 0.86 + grain * 0.26;`,
      );
  };
  return material;
}

export function Terrain({
  tiles,
  onPick,
  onHover,
  dry = false,
}: {
  tiles: Tile[];
  dry?: boolean;
  onPick?: (tile: number, e: ThreeEvent<MouseEvent>) => void;
  onHover?: (tile: number) => void;
}) {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(SIZE, SIZE, N - 1, N - 1);
    g.rotateX(-Math.PI / 2);
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(N * N * 3), 3));
    g.setAttribute("splatA", new THREE.BufferAttribute(new Float32Array(N * N * 4), 4));
    g.setAttribute("splatB", new THREE.BufferAttribute(new Float32Array(N * N * 4), 4));
    // Rivers, lakes and the lagoon are painted into the ground itself (x: wet, y: lagoon).
    g.setAttribute("wet", new THREE.BufferAttribute(new Float32Array(N * N * 2), 2));
    return g;
  }, []);
  // The photographed ground, once its textures arrive (painted colours until then).
  const [photo, setPhoto] = useState<THREE.MeshStandardMaterial | null>(null);
  useEffect(() => {
    let live = true;
    loadGround()
      .then((tex) => live && setPhoto(groundMaterial(tex)))
      .catch((err) => console.warn("Keeping the painted ground:", err));
    return () => {
      live = false;
    };
  }, []);
  useFrame(({ clock }) => {
    groundUniforms.uTime.value = clock.elapsedTime;
    groundUniforms.uBlue.value = env.blueprint;
    groundUniforms.uCloud.value = env.raining ? 0.3 : env.daylight;
    groundUniforms.uDry.value += ((dry ? 1 : 0) - groundUniforms.uDry.value) * 0.01;
  });
  const material = useMemo(
    () =>
      detailed(
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 }),
      ),
    [],
  );

  useLayoutEffect(() => {
    // Per-tile colours (or, for the photographed ground, tints) and surface weights first.
    const colors = new Float32Array(SIZE * SIZE * 3);
    const splats = new Float32Array(SIZE * SIZE * 8);
    const c = new THREE.Color();
    const w8 = new Float32Array(8);
    const tint = new Float32Array(3);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      let slope = 0;
      for (const n of around(i)) slope = Math.max(slope, Math.abs(tiles[n].h - t.h));
      if (photo) {
        tileGround(t, slope, w8, tint);
        splats.set(w8, i * 8);
        colors.set(tint, i * 3);
      } else {
        tileColor(t, c, slope);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
    }
    const sa = geometry.attributes.splatA as THREE.BufferAttribute;
    const wetA = geometry.attributes.wet as THREE.BufferAttribute;
    const sb = geometry.attributes.splatB as THREE.BufferAttribute;
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const col = geometry.attributes.color as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const z = pos.getZ(k);
      let y = heightAt(tiles, x, z);
      // Rivers and lakes sit in a channel below their banks: any vertex that
      // touches a wet tile drops below that tile's water.
      const gx = x + HALF;
      const gz = z + HALF;
      for (const [ox, oz] of [
        [-0.01, -0.01],
        [0.01, -0.01],
        [-0.01, 0.01],
        [0.01, 0.01],
      ]) {
        const cx = Math.floor(gx + ox);
        const cz = Math.floor(gz + oz);
        if (cx < 0 || cz < 0 || cx >= SIZE || cz >= SIZE) continue;
        const t = tiles[cz * SIZE + cx];
        if (t.water === RIVER || t.water === LAKE) y = Math.min(y, t.h - 0.2);
      }
      pos.setY(k, y);
      // Blend the four nearest tile colours.
      const fx = Math.max(0, Math.min(SIZE - 1.001, x + HALF - 0.5));
      const fz = Math.max(0, Math.min(SIZE - 1.001, z + HALF - 0.5));
      const x0 = Math.floor(fx);
      const z0 = Math.floor(fz);
      const u = fx - x0;
      const v = fz - z0;
      let r = 0;
      let gg = 0;
      let b = 0;
      const blend = new Float32Array(8);
      let wetness = 0;
      let lagoon = 0;
      for (const [dx, dz, w] of [
        [0, 0, (1 - u) * (1 - v)],
        [1, 0, u * (1 - v)],
        [0, 1, (1 - u) * v],
        [1, 1, u * v],
      ] as const) {
        const i = (z0 + dz) * SIZE + (x0 + dx);
        r += colors[i * 3] * w;
        gg += colors[i * 3 + 1] * w;
        b += colors[i * 3 + 2] * w;
        for (let l = 0; l < 8; l++) blend[l] += splats[i * 8 + l] * w;
        const tt = tiles[i];
        if (tt.water === RIVER || tt.water === LAKE) wetness += w;
        if (tt.biome === "lagoon") lagoon += w;
      }
      col.setXYZ(k, r, gg, b);
      sa.setXYZW(k, blend[0], blend[1], blend[2], blend[3]);
      sb.setXYZW(k, blend[4], blend[5], blend[6], blend[7]);
      wetA.setXY(k, wetness, lagoon);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    sa.needsUpdate = true;
    sb.needsUpdate = true;
    wetA.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }, [tiles, geometry, photo]);

  return (
    <mesh
      geometry={geometry}
      material={photo ?? material}
      receiveShadow
      castShadow
      onClick={(e) => {
        if (!onPick || e.delta > 8) return;
        e.stopPropagation();
        const i = tileAtWorld(e.point.x, e.point.z);
        if (i >= 0) onPick(i, e);
      }}
      onPointerMove={(e) => {
        if (!onHover) return;
        const i = tileAtWorld(e.point.x, e.point.z);
        if (i >= 0) onHover(i);
      }}
    />
  );
}

/** Whether a tile is dry land. */
export const isLand = (t: Tile) => t.water !== SEA;
