// Which model plays which species, and which of its clips plays which behaviour.
// Clip specs: { src: substring of the model's clip name } or a synthesised clip:
// { base, at, dur, mods: [{ bones: regex, axis, amp, freq, phase, offset }] }
// Mods rotate bones about a model-space axis (after the model faces +z).
const PI = Math.PI;
const legs = (hipL, hipR, kneeL, kneeR, amp = 0.45, knee = 0.4) => [
  { bones: hipL, axis: "x", amp, freq: 1, phase: 0 },
  { bones: hipR, axis: "x", amp, freq: 1, phase: PI },
  { bones: kneeL, axis: "x", amp: -knee, freq: 1, phase: PI / 2, offset: -knee * 0.6 },
  { bones: kneeR, axis: "x", amp: -knee, freq: 1, phase: PI * 1.5, offset: -knee * 0.6 },
];
const breathe = (neck, tail) => [
  { bones: neck, axis: "y", amp: 0.06, freq: 1, phase: 0 },
  { bones: neck, axis: "x", amp: 0.03, freq: 2, phase: 1 },
  { bones: tail, axis: "y", amp: 0.05, freq: 1, phase: 1.5 },
];

export const CONFIG = {
  titan: {
    file: "cba596d2",
    ref: "Walk.001",
    clips: {
      walk: { src: "Walk.001" },
      idle: { src: "|Idle" },
      graze: { src: "Armature.001Action", fps: 8, max: 120 },
    },
  },
  hornface: {
    file: "d5658e6f",
    ref: "|Walk",
    tint: [0.62, 0.6, 0.52],
    clips: {
      walk: { src: "|Walk" },
      run: { src: "|Walk", speed: 1.8 },
      idle: { src: "|Idle" },
      graze: { src: "|Eat" },
      rest: { src: "|Lying.001" },
      roar: { src: "|Roar" },
    },
  },
  duckbill: {
    file: "07e496bd",
    ref: "C4D",
    clips: {
      idle: { src: "C4D" },
      walk: {
        base: "C4D",
        at: 0,
        dur: 1.4,
        mods: [
          ...legs(/^l_leg/, /^r_leg/, /^l_knee/, /^r_knee/, 0.38, 0.35),
          { bones: /^c_tail[1-3]/, axis: "y", amp: 0.06, freq: 1, phase: 0 },
          { bones: /^c_neck1/, axis: "x", amp: 0.04, freq: 2, phase: 0 },
        ],
      },
      run: {
        base: "C4D",
        at: 0,
        dur: 0.8,
        mods: [
          ...legs(/^l_leg/, /^r_leg/, /^l_knee/, /^r_knee/, 0.6, 0.55),
          { bones: /^c_tail[1-3]/, axis: "y", amp: 0.08, freq: 1, phase: 0 },
          { bones: /^c_back1/, axis: "x", amp: 0.04, freq: 2, phase: 0 },
        ],
      },
      graze: {
        base: "C4D",
        dur: 3,
        mods: [
          { bones: /^c_back1/, axis: "x", amp: 0, offset: 0.25 },
          { bones: /^c_neck[12]/, axis: "x", amp: 0.06, freq: 2, offset: 0.35 },
          { bones: /^c_head/, axis: "x", amp: 0.12, freq: 3, offset: 0.2 },
          { bones: /^c_jaw/, axis: "x", amp: 0.08, freq: 6, offset: 0.08 },
        ],
      },
    },
  },
  plateback: {
    file: "53d3dcc8",
    turn: PI,
    ref: "ankylosaurus_walk",
    clips: {
      walk: { src: "ankylosaurus_walk" },
      run: { src: "ankylosaurus_run" },
      idle: { src: "idle" },
      roar: { src: "ankylosaurus_roar" },
      tail: { src: "ankylosaurus_tail" },
    },
  },
  snapper: {
    file: "5be34917",
    ref: "C4D",
    clips: {
      idle: { src: "C4D" },
      walk: {
        base: "C4D",
        at: 0,
        dur: 0.7,
        mods: [
          ...legs(/^bip_hip_l/, /^bip_hip_r/, /^bip_knee_l/, /^bip_knee_r/, 0.5, 0.5),
          { bones: /^bip_tail_[0-3]/, axis: "y", amp: 0.05, freq: 1, phase: 0 },
        ],
      },
      run: {
        base: "C4D",
        at: 0,
        dur: 0.42,
        mods: [
          ...legs(/^bip_hip_l/, /^bip_hip_r/, /^bip_knee_l/, /^bip_knee_r/, 0.8, 0.7),
          { bones: /^bip_tail_[0-3]/, axis: "y", amp: 0.06, freq: 1, phase: 0 },
          { bones: /^bip_spine_0/, axis: "x", amp: 0.05, freq: 2, phase: 0 },
        ],
      },
      graze: {
        base: "C4D",
        dur: 2,
        mods: [
          { bones: /^bip_spine_[12]/, axis: "x", amp: 0, offset: 0.3 },
          { bones: /^bip_neck_[12]/, axis: "x", amp: 0.1, freq: 3, offset: 0.35 },
          { bones: /^bip_head/, axis: "x", amp: 0.15, freq: 4, offset: 0.2 },
        ],
      },
    },
  },
  tyrant: {
    file: "c924da45",
    ref: "loopWalk_",
    clips: {
      walk: { src: "loopWalk_" },
      run: { src: "loopRuning" },
      idle: { src: "loopIdle_" },
      sniff: { src: "loopIdleSmellko" },
      eat: { src: "loopEating", fps: 10 },
      roar: { src: "loopRoarning" },
      attack: { src: "loopAttackJaw" },
    },
  },
  raptor: {
    file: "45a25c68",
    ref: "loopWalk",
    clips: {
      walk: { src: "loopWalk_" },
      run: { src: "loopRun_" },
      idle: { src: "loopIdle_" },
      look: { src: "loopLookRound_" },
      eat: { src: "loopEating_" },
      attack: { src: "loopJumpAtack" },
      creep: { src: "loopCreeping" },
    },
  },
  skywing: {
    file: "6349f561",
    ref: "loopSoaring",
    clips: {
      fly: { src: "loopFlying" },
      glide: { src: "loopSoaring" },
      idle: { src: "loopIdle01" },
      walk: { src: "loopWalk_" },
      eat: { src: "loopEating" },
    },
  },
  leviathan: {
    file: "6c343575",
    ref: "Animation",
    clips: {
      swim: { src: "Animation", fps: 8, max: 110 },
    },
  },
};
