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
  pelvisLift: number;
  pelvisRoll: number;
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
  const support = family === "heavy-quad" ? 0.82 : family === "quad" ? 0.7 : 0.58;
  const cycle = footCycle(0, support);
  const pelvisAmount = family === "heavy-quad" ? 0.012 : family === "quad" ? 0.02 : 0.028;
  return {
    stride,
    phaseFrontLeft: 0,
    phaseFrontRight: diagonal,
    phaseBackLeft: rearOffset + diagonal,
    phaseBackRight: rearOffset,
    bodyLean: Math.max(-0.16, Math.min(0.12, -motion.acceleration * 0.035)),
    tailLag: Math.max(-0.35, Math.min(0.35, -motion.yawRate * 0.22)),
    headCounterTurn: Math.max(-0.24, Math.min(0.24, -motion.yawRate * 0.15)),
    pelvisLift: cycle.lift * pelvisAmount * pace,
    pelvisRoll: Math.sin(motion.speed * 0.15) * pelvisAmount * 0.35,
  };
}

export interface FootCycle {
  /** 0..1 progress through the stride. */
  progress: number;
  /** True while this foot should remain planted. */
  planted: boolean;
  /** Smooth 0..1..0 clearance during the swing. */
  lift: number;
  /** Fore/aft leg sweep, -1 behind to +1 ahead. */
  sweep: number;
}

/** A stance-heavy foot cycle: slow on the ground, quick and arced in the air. */
export function footCycle(phase: number, dutyFactor: number): FootCycle {
  const progress = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
  const duty = Math.max(0.5, Math.min(0.9, dutyFactor));
  if (progress < duty) {
    const stance = progress / duty;
    return { progress, planted: true, lift: 0, sweep: 1 - stance * 2 };
  }
  const swing = (progress - duty) / (1 - duty);
  return {
    progress,
    planted: false,
    lift: Math.sin(swing * Math.PI),
    sweep: -1 + swing * 2,
  };
}

/** Advance the gait clock by distance covered, not by render time. */
export function advanceGaitPhase(phase: number, distance: number, strideLength: number) {
  if (distance <= 0 || strideLength <= 0) return phase;
  return (phase + (distance / strideLength) * Math.PI * 2) % (Math.PI * 2);
}

/** Body-length fraction covered by one full cycle for each locomotion family. */
export function strideLengthFor(family: GaitFamily, bodyLength: number, running: boolean) {
  const fraction =
    family === "heavy-quad" ? (running ? 0.62 : 0.38) :
      family === "quad" ? (running ? 0.78 : 0.46) :
        family === "biped" ? (running ? 1.05 : 0.56) : 0.9;
  return Math.max(0.08, bodyLength * fraction);
}

/** Turning is weakest mid-stance, preventing turntable-like planted feet. */
export function plantedTurnScale(phase: number, family: GaitFamily) {
  if (family === "fly" || family === "swim") return 1;
  const duty = family === "heavy-quad" ? 0.82 : family === "quad" ? 0.7 : 0.58;
  return footCycle(phase, duty).planted ? (family === "heavy-quad" ? 0.42 : 0.62) : 1;
}

/** Preserve normalized footfall phase when changing locomotion clips. */
export function phaseMatchedTime(oldTime: number, oldDuration: number, newDuration: number) {
  if (oldDuration <= 0 || newDuration <= 0) return 0;
  const phase = ((oldTime / oldDuration) % 1 + 1) % 1;
  return phase * newDuration;
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
