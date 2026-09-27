import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode, type BloomEffect } from "postprocessing";
import { env } from "./env";

/**
 * Film-like finishing for larger screens: ambient occlusion grounds the
 * buildings and actors, bloom makes signs, lamps, fire and lightning glow
 * (more at night), and ACES tone mapping and a light vignette give the frame
 * a photographic roll-off. Phones skip it and keep the renderer's own
 * tone mapping.
 */
export function PostFX() {
  const bloom = useRef<BloomEffect>(null);
  useFrame(() => {
    if (bloom.current) bloom.current.intensity = env.night ? 1.1 : 0.45 + env.flash * 1.5;
  });
  return (
    <EffectComposer multisampling={4}>
      <N8AO halfRes aoRadius={1.2} distanceFalloff={0.8} intensity={2.4} quality="performance" />
      <Bloom
        ref={bloom}
        mipmapBlur
        luminanceThreshold={0.82}
        luminanceSmoothing={0.25}
        intensity={0.45}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.28} darkness={0.42} />
    </EffectComposer>
  );
}
