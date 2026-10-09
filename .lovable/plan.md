# Dinosaur locomotion realism plan

## Diagnosis

The awkward motion comes from several systems disagreeing:

- **Feet do not drive the body.** Recorded walk/run clips are retimed from estimated travel distance, while the animal body is moved separately. Playback is clamped to 0.5–2×, so some species cannot match their actual movement speed and visibly skate (`Dinos.tsx:296–316`).
- **The procedural fallback has no planted-foot phase.** Each whole leg is a single rigid segment rotating with a sine wave; there are no knees, ankles, stance locks, or foot targets (`Dinos.tsx:323–378`, `dinoModels.ts:42–96`). This reads as paddling rather than carrying weight.
- **Cadence is disconnected from stride length.** Fallback leg phase uses a generic speed formula for every species instead of distance traveled per stride (`Dinos.tsx:1236`). The smallest species has the largest mismatch between configured movement and its recorded walk, making it especially unnatural.
- **Bodies float over terrain.** Ground height and body pitch sample the chest and hips, but individual feet never sample or lock to the surface (`Dinos.tsx:1237–1257`). On slopes, legs penetrate or hover.
- **Weight cues are too generic.** The fallback adds the same absolute-sine vertical bob to every land animal, while skinned models receive no procedural weight shift layered onto their clips (`Dinos.tsx:1330–1374`).
- **Turning rotates the whole animal around its centre.** Turn rate varies by size, but there is no inside/outside step adjustment, planted pivot foot, lateral lean, or pelvis compensation (`Dinos.tsx:1157–1184`).
- **Clip transitions can pop in phase.** A new locomotion clip starts from a per-animal hashed time rather than matching the outgoing contact phase (`Dinos.tsx:288–319`).

A separate current preview diagnostic also reports an R3F `data-tsd-source` runtime error. It is not the cause of the gait itself, but it must be ruled out before final visual validation.

## Build

1. **Make locomotion distance-driven**
   - Create one species-aware gait profile for walk/run stride distance, cadence, duty factor, weight, and turn limits.
   - Advance gait phase from actual distance traveled, not a generic clock.
   - Select walk/run thresholds with hysteresis so clips do not flicker near the boundary.

2. **Plant the feet**
   - Track stance and swing phases per foot.
   - Lock each stance foot in world space, lift it through a short swing arc, and place it on sampled terrain.
   - Add lightweight two-bone leg solving where the model supports it; use pelvis correction and bounded ankle offsets for baked models.
   - Keep all of this visual and frame-based so ecology outcomes remain deterministic.

3. **Give each dinosaur believable weight**
   - Heavy quadrupeds: long stance, slow transfer, minimal bounce, visible compression.
   - Light bipeds: quicker cadence, alternating hips, controlled head stabilization, tail counterbalance.
   - Large bipeds: shorter acceleration, stronger braking, reduced turn speed while running.
   - Replace universal bobbing with gait-specific pelvis height, roll, and fore/aft weight transfer.

4. **Correct clip synchronization**
   - Calibrate every model’s measured clip travel against its displayed body length.
   - Remove playback clamps that force skating; cap body speed to the clip’s believable range instead.
   - Match foot-contact phase when blending walk, run, creep, and idle.
   - Preserve attacks, grazing, and other authored actions without locomotion retiming.

5. **Improve turning and slopes**
   - Slow sharply before large heading changes.
   - Adjust inside/outside step length during turns and add subtle pelvis/tail counter-rotation.
   - Derive body height from planted feet rather than only chest/hip terrain samples.

6. **Validate visibly and with tests**
   - First resolve or isolate the current R3F preview diagnostic.
   - Add pure tests for distance-to-phase, stance locking, gait transitions, speed limits, and size-dependent turning.
   - Capture close follow-camera sequences for titan, hornface, tyrant, and raptor on flat ground, slopes, starts, stops, and turns.
   - Verify no foot sliding, hovering, clipping, abrupt clip pops, or ecology regression at normal and reduced frame rates.

## Technical boundary

The daily world reducer remains authoritative for populations, survival, and ecology. Foot placement, pose solving, clip timing, and secondary motion stay in the render frame loop and pure motion helpers, so frame rate cannot alter simulation results.
