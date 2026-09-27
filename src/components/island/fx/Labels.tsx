import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Screen-space labels for 3D positions, shown by zoom level: region names
 * from high up, landmark names closer in, and the name of a god's act while
 * it plays. Plain DOM nodes moved by a projector inside the canvas.
 */
export interface LabelSpec {
  key: string;
  x: number;
  y: number;
  z: number;
  text: string;
  variant: "region" | "landmark" | "action";
  /** Camera distances (to its target) between which the label shows. */
  near?: number;
  far?: number;
}

export type LabelRegistry = Map<string, HTMLDivElement>;

const v = new THREE.Vector3();

export function LabelProjector({
  specs,
  registry,
}: {
  specs: LabelSpec[];
  registry: React.MutableRefObject<LabelRegistry>;
}) {
  const { camera, size } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  const specsRef = useRef(specs);
  specsRef.current = specs;
  useFrame(() => {
    const zoom = controls ? camera.position.distanceTo(controls.target) : camera.position.length();
    for (const s of specsRef.current) {
      const el = registry.current.get(s.key);
      if (!el) continue;
      const inRange = zoom >= (s.near ?? 0) && zoom <= (s.far ?? Infinity);
      v.set(s.x, s.y, s.z).project(camera);
      const behind = v.z > 1 || v.z < -1;
      el.style.visibility = behind || !inRange ? "hidden" : "visible";
      if (behind || !inRange) continue;
      const px = ((v.x + 1) / 2) * size.width;
      const py = ((1 - v.y) / 2) * size.height;
      el.style.transform = `translate(-50%, -50%) translate(${px}px, ${py}px)`;
    }
  });
  return null;
}

const STYLE: Record<LabelSpec["variant"], string> = {
  region:
    "absolute left-0 top-0 whitespace-nowrap font-serif-d text-[10px] font-black uppercase tracking-[0.12em] text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.85),0_0_12px_rgba(0,0,0,0.5)] sm:text-[15px] sm:tracking-[0.18em]",
  landmark:
    "absolute left-0 top-0 whitespace-nowrap rounded-sm bg-black/60 px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#f5e9cf]",
  action:
    "absolute left-0 top-0 z-20 whitespace-nowrap border-2 border-[#2a1d14] bg-[#f3e2c0] px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#2a1d14] shadow-[2px_2px_0_0_#2a1d14]",
};

export function LabelOverlay({
  specs,
  registry,
  show,
}: {
  specs: LabelSpec[];
  registry: React.MutableRefObject<LabelRegistry>;
  show: boolean;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {specs.map((s) => (
        <div
          key={s.key}
          ref={(el) => {
            if (el) registry.current.set(s.key, el);
            else registry.current.delete(s.key);
          }}
          className={STYLE[s.variant]}
          style={{
            display: s.variant !== "action" && !show ? "none" : "block",
            visibility: "hidden",
          }}
        >
          {s.text}
        </div>
      ))}
    </div>
  );
}
