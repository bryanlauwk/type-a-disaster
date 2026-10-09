# Living Animals Upgrade

## Goal
Make the island’s animals feel heavier, more observant, and physically connected to the terrain. Preserve the current deterministic daily ecology, existing art direction, and mobile performance.

## What will change

### 1. More natural locomotion
- Replace the shared sine-wave leg motion with species-aware gait profiles for bipeds, heavy quadrupeds, light quadrupeds, flyers, and swimmers.
- Blend stride length and limb phase continuously from idle through walk, trot, and run instead of snapping between two animations.
- Add lightweight foot planting for nearby animals so feet meet uneven ground rather than floating or clipping through slopes.
- Keep distant animals on the current cheaper animation path to protect frame rate.

### 2. Weight and secondary motion
- Track acceleration and turn velocity for each visible animal.
- Use those forces to drive head stabilization, neck follow-through, tail lag, body lean, and braking posture.
- Scale starts, stops, turning arcs, and falls by body size so a Titan no longer moves or collapses like a Snapper.
- Keep animation frame-rate independent with clamped delta time and exponential smoothing.

### 3. Organic herd and pack movement
- Add anticipatory separation, alignment, and cohesion around the existing herd targets instead of relying only on fixed slots and late collision correction.
- Keep young animals protected near the herd center while adults form looser outer spacing.
- Give predators clearer stalking, flanking, commitment, failed-chase, fatigue, and feeding phases.
- Add cohesive flocking for Skywings and pod movement for Leviathans, which currently orbit independently.

### 4. Behavior that responds to the simulated world
- Make thirst, heat, fear, hunger, nearby carcasses, rain, fire, and river conditions influence visible decisions.
- Improve drinking, grazing, resting, vigilance, threat displays, and post-chase recovery so behaviors have readable beginnings and endings.
- Translate daily births, deaths, migrations, and outbreaks into short visual moments without changing simulation results.
- Keep the daily ecology authoritative; frame-level behavior will visualize state, never alter population math.

### 5. Physical contact and environmental feedback
- Improve slope alignment and local obstacle avoidance so animals do not bunch into terrain edges.
- Time dust to actual ground contact rather than a generic running interval.
- Add restrained wakes for swimmers and waders, and nearby foliage disturbance for large bodies.
- Reuse pooled effects and distance limits instead of adding full rigid-body physics.

### 6. Inspection and readability
- Expand the selected-animal panel with the animal’s current intent, pace, alertness, and condition.
- Keep follow mode locked to the selected individual while it remains alive, instead of silently switching to another member of the species.
- Surface major transitions such as beginning a chase, reaching water, escaping danger, or losing the followed animal.

## Technical approach
- Extend the existing `Agent` and `lifeBus` data with velocity, angular velocity, fatigue, intent, and stable follow identity.
- Keep ecology in the deterministic day-tick reducer and kinetics in the render loop; use event descriptors to bridge meaningful daily changes to visuals.
- Refactor the large animal update loop into focused gait, steering, behavior, and pose helpers while retaining the existing prepared geometry and instancing system.
- Use distance-based levels of detail: full contact and secondary motion nearby, simplified gait in the middle distance, current low-cost instancing farther away.
- Avoid a general physics engine; these animals need controlled kinematic motion, not expensive rigid-body simulation.

## Validation
- Add focused tests for deterministic behavior selection, stable follow identity, fatigue recovery, and species-specific gait/turn limits.
- Run the existing island and challenge tests to confirm ecology outcomes remain unchanged.
- Verify close-up locomotion, hunts, herd panic, flocking, swimming, slopes, follow mode, and reduced-motion behavior in the live island.
- Compare desktop and mobile-sized views, checking for foot sliding, clipping, agent overlap, visual errors, and frame-rate regressions.
