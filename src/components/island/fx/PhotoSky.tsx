import { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { env } from "./env";

/**
 * A photographed sky and image-based lighting, from Poly Haven's CC0
 * "Kloofendal 48d Partly Cloudy (Pure Sky)" HDRI by Greg Zaal and Jarod Guest.
 *
 * The HDR lights the scene: glass towers and PBR models reflect a real sky,
 * and shadows pick up its soft blue fill. A 2K photo of the same sky is drawn
 * on a dome by day. It fades into <Sky>'s colour at dusk, in rain and haze,
 * and at night, when the environment dims so the city's own lights lead.
 */
export function PhotoSky() {
  const { gl, scene, camera } = useThree();
  const hdr = useLoader(HDRLoader, "/sky/kloofendal-1k.hdr");
  const photo = useLoader(THREE.TextureLoader, "/sky/kloofendal-sky-2k.jpg");
  const dome = useRef<THREE.Mesh>(null);

  const envMap = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const target = pmrem.fromEquirectangular(hdr);
    pmrem.dispose();
    return target.texture;
  }, [gl, hdr]);

  useEffect(() => {
    scene.environment = envMap;
    // Turn the photographed sun behind the default view, roughly where <Sky>'s sun is.
    scene.environmentRotation.set(0, SUN_TURN, 0);
    return () => {
      scene.environment = null;
      envMap.dispose();
    };
  }, [scene, envMap]);

  const material = useMemo(() => {
    photo.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({
      map: photo,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
  }, [photo]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    // How much of the photographed sky shows over <Sky>'s flat colour.
    const show =
      Math.min(1, env.daylight * 2.2) *
      (1 - env.dusk * 0.6) *
      (env.raining ? 0.2 : 1) *
      (env.hazy ? 0.35 : 1) *
      (env.upside ? 0 : 1 - Math.min(0.7, env.rift / 120));
    material.opacity = show;
    // Warmer towards sunset; brighter in a lightning flash.
    const warm = env.dusk * 0.35;
    const lift = 1.05 + env.flash * 0.8;
    material.color.setRGB(lift, lift * (1 - warm * 0.35), lift * (1 - warm * 0.6));
    scene.environmentIntensity =
      (0.08 + env.daylight * 0.42) * (env.raining ? 0.55 : 1) * (env.upside ? 0.08 : 1);
    // Centred on the camera, so the dome's edge never comes into view.
    dome.current?.position.copy(camera.position);
  });

  return (
    <mesh
      ref={dome}
      material={material}
      renderOrder={-1}
      frustumCulled={false}
      rotation-y={SUN_TURN}
    >
      <sphereGeometry args={[150, 48, 24]} />
    </mesh>
  );
}

const SUN_TURN = Math.PI * 0.35;
