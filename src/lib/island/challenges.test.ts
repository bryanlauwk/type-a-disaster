/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { CHALLENGES, createChallengeWorld, judgeChallenge } from "./challenges";
import { tick } from "./sim";

describe("challenges", () => {
  test("long drought starts with 60 days of drought", () => {
    expect(createChallengeWorld("long_drought", 3).weather.drought).toBe(60);
  });
  test("lean start begins with no favour or food", () => {
    const s = createChallengeWorld("lean_start", 3);
    expect(s.favour).toBe(0);
    expect(s.tribe.food).toBe(0);
  });
  test("losing the tribe below the minimum loses the challenge", () => {
    const s = createChallengeWorld("ashfall", 3);
    s.tribe.pop = 9;
    judgeChallenge(s);
    expect(s.challenge?.result).toBe("lost");
  });
  test("lean start is won by reaching a village by day 200", () => {
    const s = createChallengeWorld("lean_start", 3);
    s.day = s.challenge!.startDay + 200;
    s.tribe.stage = 1;
    s.tribe.pop = 20;
    judgeChallenge(s);
    expect(s.challenge?.result).toBe("won");
  });
  test("every challenge survives a simulated day", () => {
    for (const c of CHALLENGES) expect(tick(createChallengeWorld(c.id, 5)).challenge?.id).toBe(c.id);
  });
});
