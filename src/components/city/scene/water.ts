import * as THREE from "three";
import { GRID_SIZE, type Tile } from "@/lib/city/types";
import { surgeDepth, type Surge } from "@/lib/city/surge";

/**
 * The town's water level: one depth value per half-tile cell, shared by every
 * system. Surges write into it, flooded tiles hold a standing pool, the water
 * surface draws it, and buildings and people read it to know they're wet.
 */
export const W = GRID_SIZE * 2;
const CELL = GRID_SIZE / W;
const HALF = GRID_SIZE / 2;
/** Encoded depth range in the texture. */
export const MAX_DEPTH = 3.2;
/** Standing water on a flooded tile. */
const POOL = 0.14;

export class WaterField {
  depth = new Float32Array(W * W);
  foam = new Float32Array(W * W);
  target = new Float32Array(W * W);
  data = new Uint8Array(W * W * 4);
  texture: THREE.DataTexture;
  /** Deepest water anywhere right now, so idle systems can skip work. */
  maxDepth = 0;
  /** Direction the water is flowing (unit), for leaning buildings. */
  flow = { x: 1, z: 0 };

  constructor() {
    this.texture = new THREE.DataTexture(this.data, W, W, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }

  /** Flooded tiles hold a pool; a cell's pool softens at the edges. */
  setStanding(grid: Tile[]) {
    for (let cz = 0; cz < W; cz++)
      for (let cx = 0; cx < W; cx++) {
        const tx = Math.floor((cx * CELL) / 1);
        const ty = Math.floor((cz * CELL) / 1);
        const t = grid[ty * GRID_SIZE + tx];
        this.target[cz * W + cx] = t && t.flood > 0 && t.kind !== "water" ? POOL : 0;
      }
    this.pooled = this.target.some((v) => v > 0);
  }

  /** Depth at a world point, bilinear. */
  sample(x: number, z: number): number {
    const fx = (x + HALF) / CELL - 0.5;
    const fz = (z + HALF) / CELL - 0.5;
    const x0 = Math.max(0, Math.min(W - 1, Math.floor(fx)));
    const z0 = Math.max(0, Math.min(W - 1, Math.floor(fz)));
    const x1 = Math.min(W - 1, x0 + 1);
    const z1 = Math.min(W - 1, z0 + 1);
    const u = Math.min(1, Math.max(0, fx - x0));
    const v = Math.min(1, Math.max(0, fz - z0));
    const d = this.depth;
    return (
      (d[z0 * W + x0] * (1 - u) + d[z0 * W + x1] * u) * (1 - v) +
      (d[z1 * W + x0] * (1 - u) + d[z1 * W + x1] * u) * v
    );
  }

  /** Some tile is flooded (so the pools need drawing). */
  private pooled = false;

  /** Advance the water: rise fast, drain slowly. */
  step(dt: number, surge: Surge | null) {
    // A dry town with nothing coming: nothing to do.
    if (!surge && !this.pooled && this.maxDepth === 0) return;
    if (surge && surge.kind === "tsunami") this.flow = { x: surge.dx, z: surge.dz };
    let max = 0;
    const d = this.depth;
    const f = this.foam;
    const rise = Math.min(1, dt * 12);
    const drain = Math.min(1, dt * 0.9);
    const fade = Math.exp(-dt * 1.4);
    for (let cz = 0; cz < W; cz++) {
      const z = (cz + 0.5) * CELL - HALF;
      for (let cx = 0; cx < W; cx++) {
        const i = cz * W + cx;
        let target = this.target[i];
        let foam = f[i] * fade;
        if (surge) {
          const x = (cx + 0.5) * CELL - HALF;
          const [sd, sf] = surgeDepth(surge, x, z);
          if (sd > target) target = sd;
          if (sf > foam) foam = sf;
        }
        d[i] += (target - d[i]) * (target > d[i] ? rise : drain);
        if (d[i] < 0.002 && target === 0) d[i] = 0;
        f[i] = foam;
        if (d[i] > max) max = d[i];
        const o = i * 4;
        this.data[o] = Math.min(255, Math.round((d[i] / MAX_DEPTH) * 255));
        this.data[o + 1] = Math.min(255, Math.round(foam * 255));
      }
    }
    this.maxDepth = max;
    this.texture.needsUpdate = true;
  }
}
