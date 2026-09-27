/** Global lighting/weather state, written by <Sky> every frame and read by other systems. */
export const env = {
  hour: 10,
  night: false,
  raining: false,
  /** 0 at night, 1 at noon. */
  daylight: 1,
  /** 1 around sunrise and sunset. */
  dusk: 0,
  hazy: false,
  /** 1 on a lightning flash, fading to 0. */
  flash: 0,
  /** Looking at the Upside Down rather than the town. */
  upside: false,
  /** 0–100: how far the Upside Down has broken through. */
  rift: 0,
};
