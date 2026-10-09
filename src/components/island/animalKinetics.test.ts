/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  advanceGaitPhase,
  footCycle,
  gaitPose,
  phaseMatchedTime,
  plantedTurnScale,
  strideLengthFor,
  turnRateFor,
  updateFatigue,
} from "./animalKinetics";

describe("animal kinetics", () => {
  test("stride grows continuously with speed and fatigue reduces it", () => {
    const slow = gaitPose("quad", { speed: 0.4, maxWalk: 1, maxRun: 2.5, yawRate: 0, acceleration: 0, fatigue: 0 });
    const fast = gaitPose("quad", { speed: 2, maxWalk: 1, maxRun: 2.5, yawRate: 0, acceleration: 0, fatigue: 0 });
    const tired = gaitPose("quad", { speed: 2, maxWalk: 1, maxRun: 2.5, yawRate: 0, acceleration: 0, fatigue: 1 });
    expect(fast.stride).toBeGreaterThan(slow.stride);
    expect(tired.stride).toBeLessThan(fast.stride);
  });

  test("large heavy animals turn more slowly", () => {
    expect(turnRateFor("heavy-quad", 4.4, false)).toBeLessThan(turnRateFor("biped", 0.6, false));
  });

  test("fatigue rises under effort and recovers at rest", () => {
    const worked = updateFatigue(0, 1, 10);
    expect(worked).toBeGreaterThan(0.5);
    expect(updateFatigue(worked, 0, 10)).toBeLessThan(worked);
  });

  test("gait phase advances by distance rather than frame time", () => {
    const stride = strideLengthFor("biped", 2, false);
    expect(advanceGaitPhase(0, stride / 2, stride)).toBeCloseTo(Math.PI);
    expect(advanceGaitPhase(1.2, 0, stride)).toBe(1.2);
  });

  test("stance is planted and swing lifts the foot", () => {
    expect(footCycle(0.2, 0.7).planted).toBe(true);
    const swing = footCycle(Math.PI * 2 * 0.85, 0.7);
    expect(swing.planted).toBe(false);
    expect(swing.lift).toBeGreaterThan(0.9);
  });

  test("heavy animals turn least while a foot bears weight", () => {
    expect(plantedTurnScale(0.2, "heavy-quad")).toBeLessThan(plantedTurnScale(0.2, "biped"));
  });

  test("clip changes retain footfall phase", () => {
    expect(phaseMatchedTime(0.75, 1, 2)).toBeCloseTo(1.5);
  });
});