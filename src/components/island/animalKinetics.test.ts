/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { gaitPose, turnRateFor, updateFatigue } from "./animalKinetics";

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
});