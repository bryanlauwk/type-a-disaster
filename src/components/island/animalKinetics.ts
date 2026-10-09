export type GaitFamily = "heavy-quad" | "quad" | "biped" | "fly" | "swim";

export interface MotionSample {
  speed: number;
  maxWalk: number;
  maxRun: number;
  yawRate: number;
  acceleration: number;
  fatigue: number;
}

export interface GaitPose {
  stride: number;
  phaseFrontLeft: number;
  phaseFrontRight: number;
  phaseBackLeft: number;
  phaseBackRight: number;
  bodyLean: number;
  tailLag: number;
  headCounterTurn: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Pure, testable pose controls shared by the primitive and skinned animals. */
export function gaitPose(family: GaitFamily, motion: MotionSample): GaitPose {
  const walk = Math.max(0.01, motion.maxWalk);
  const run = Math.max(walk, motion.maxRun);
  const pace = clamp01(motion.speed / run);
  const runMix = clamp01((motion.speed - walk * 0.72) / Math.max(0.01, run - walk * 0.72));
  const weight = family === "heavy-quad" ? 0.72 : family === "quad" ? 0.9 : 1;
  const stride = pace * (0.2 + runMix * 0.68) * weight * (1 - motion.fatigue * 0.18);

  // Heavy quadrupeds retain a four-beat walk; lighter quadrupeds blend toward
  // a diagonal trot. Bipeds alternate their weight-bearing legs.
  const rearOffset = family === "heavy-quad" ? Math.PI * 0.55 : Math.PI;
  const diagonal = family === "quad" ? Math.PI * (0.75 + runMix * 0.25) : Math.PI;
  return {
    stride,
    phaseFrontLeft: 0,
    phaseFrontRight: diagonal,
    phaseBackLeft: rearOffset + diagonal,
    phaseBackRight: rearOffset,
    bodyLean: Math.max(-0.16, Math.min(0.12, -motion.acceleration * 0.035)),
    tailLag: Math.max(-0.35, Math.min(0.35, -motion.yawRate * 0.22)),
    headCounterTurn: Math.max(-0.24, Math.min(0.24, -motion.yawRate * 0.15)),
  };
}

export function turnRateFor(family: GaitFamily, bodyLength: number, running: boolean) {
  const base = family === "heavy-quad" ? 2.2 : family === "biped" ? 3.8 : 3.2;
  return (base / (0.7 + bodyLength * 0.35)) * (running ? 1.25 : 1);
}

export function updateFatigue(fatigue: number, effort: number, dt: number) {
  const target = clamp01(effort);
  const rate = target > fatigue ? 0.1 : 0.18;
  return clamp01(fatigue + (target - fatigue) * (1 - Math.exp(-rate * dt)));
}
