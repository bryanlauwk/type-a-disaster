import * as THREE from "three";
import META from "./impostors.meta.json";

/**
 * Real plants, drawn as impostors: each model (CC0 Poly Haven scans and CC BY
 * Sketchfab models) was photographed offline from 8 directions at 2 heights,
 * colour and surface normals both, into an atlas. Every plant on the island is
 * a single quad that turns to face the camera and shows the view that matches
 * where you're looking from, lit by the real sun through its baked normals,
 * and swaying a little in the wind. Tens of thousands draw in one call per kind.
 */

export interface ImpostorMeta {
  height: number;
  rw: number;
  rh: number;
  cy: number;
  elev: number[];
  fw: number;
  fh: number;
}

export const IMPOSTOR_META = META as unknown as Record<string, ImpostorMeta>;

export interface Impostor {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  depth: THREE.MeshDepthMaterial;
  meta: ImpostorMeta;
}

export const impostorUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

const VERT_PARS = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform vec2 uBox;    // half-width, half-height of the quad (model units)
uniform float uCy;    // centre height (model units)
uniform float uSplit; // sine of the elevation between the two rings
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vFwd;
vec2 impostorUv;
`;

// Builds the camera-facing quad and picks the matching view of the plant.
const VERT_MAIN = /* glsl */ `
vec3 origin = instanceMatrix[3].xyz;
float scl = length(instanceMatrix[0].xyz);
float yaw = atan(instanceMatrix[0].z, instanceMatrix[0].x);
vec3 centre = origin + vec3(0.0, uCy * scl, 0.0);
vec3 toCam = cameraPosition - centre;
#ifdef DEPTH_PASS
  // Shadows: face the light, not the viewer.
  toCam = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
#endif
vec3 fwd = normalize(toCam);
// Looking (or lit) straight down, "up" is ill-defined: lean on +z instead.
vec3 ref = abs(fwd.y) > 0.97 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
vec3 right = normalize(cross(ref, fwd));
vec3 up = cross(fwd, right);
float el = fwd.y;
float ring = el > uSplit ? 1.0 : 0.0;
float az = atan(fwd.x, fwd.z) - yaw;
float slot = mod(floor(az / (6.2831853 / 8.0) + 0.5), 8.0);
float k = ring * 8.0 + slot;
float col = mod(k, 4.0);
float row = floor(k / 4.0);
impostorUv = vec2((col + uv.x) / 4.0, (3.0 - row + uv.y) / 4.0);
// Wind: the top sways, the base stays put.
float sway = sin(uTime * 1.3 + origin.x * 0.7 + origin.z * 0.4) * 0.5 + sin(uTime * 2.9 + origin.x) * 0.2;
vec2 local = vec2((uv.x * 2.0 - 1.0) * uBox.x, (uv.y * 2.0 - 1.0) * uBox.y) * scl;
vec3 world = centre + right * local.x + up * local.y;
world.xz += vec2(0.6, 0.4) * sway * uWind * uv.y * uv.y * 0.02 * scl * uBox.y;
vRight = right;
vUp = up;
vFwd = fwd;
#ifdef USE_MAP
vMapUv = impostorUv;
#endif
`;

function patchVertex(shader: THREE.WebGLProgramParametersWithUniforms, depth: boolean) {
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `${depth ? "#define DEPTH_PASS\n" : ""}#include <common>\n${VERT_PARS}`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
${VERT_MAIN}`,
    )
    // Replace the whole projection: the quad is built in world space.
    .replace(
      "#include <project_vertex>",
      `vec4 mvPosition = viewMatrix * vec4(world, 1.0);
gl_Position = projectionMatrix * mvPosition;`,
    )
    .replace("#include <worldpos_vertex>", "vec4 worldPosition = vec4(world, 1.0);")
    .replace(
      "#include <defaultnormal_vertex>",
      "vec3 transformedNormal = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));",
    );
}

// Leaves thin out in the smaller mip levels; boost their alpha there so
// distant plants keep their fullness instead of breaking up.
const MIP_ALPHA = /* glsl */ `
vec2 texel = vMapUv * uAtlasSize;
vec2 ddx = dFdx(texel);
vec2 ddy = dFdy(texel);
float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
diffuseColor.a *= 1.0 + mip * 0.35;
if (diffuseColor.a < 0.5) discard;
`;

function textureFrom(url: string, srgb: boolean): Promise<THREE.Texture> {
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  });
}

const cache = new Map<string, Promise<Impostor>>();

export function loadImpostor(kind: string): Promise<Impostor> {
  let p = cache.get(kind);
  if (!p) {
    p = (async () => {
      const meta = IMPOSTOR_META[kind];
      if (!meta) throw new Error(`no impostor ${kind}`);
      const [albedo, normal] = await Promise.all([
        textureFrom(`/plants/${kind}.webp`, true),
        textureFrom(`/plants/${kind}_n.webp`, false),
      ]);
      const geometry = new THREE.PlaneGeometry(1, 1);
      const uniforms = {
        uBox: { value: new THREE.Vector2(meta.rw, meta.rh) },
        uCy: { value: meta.cy },
        uSplit: { value: Math.sin(((meta.elev[0] + meta.elev[1]) / 2) * (Math.PI / 180)) },
        uNormalAtlas: { value: normal },
        uAtlasSize: { value: new THREE.Vector2(meta.fw * 4, meta.fh * 4) },
      };
      const material = new THREE.MeshStandardMaterial({
        map: albedo,
        alphaTest: 0.5,
        roughness: 0.85,
        metalness: 0,
        envMapIntensity: 0.5,
      });
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms, impostorUniforms);
        patchVertex(shader, false);
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
uniform sampler2D uNormalAtlas;
uniform vec2 uAtlasSize;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vFwd;`,
          )
          .replace(
            "#include <normal_fragment_maps>",
            `#include <normal_fragment_maps>
vec3 bn = texture2D(uNormalAtlas, vMapUv).xyz * 2.0 - 1.0;
vec3 nw = normalize(vRight * bn.x + vUp * bn.y + vFwd * bn.z);
normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);`,
          )
          // Leaves let light through: a touch of glow when lit from behind.
          .replace(
            "#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * 0.12;`,
          )
          .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= 1.35;")
          .replace("#include <alphatest_fragment>", MIP_ALPHA);
      };
      material.customProgramCacheKey = () => "impostor";
      const depth = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: albedo,
        alphaTest: 0.5,
      });
      depth.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms, impostorUniforms);
        patchVertex(shader, true);
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform vec2 uAtlasSize;")
          .replace("#include <alphatest_fragment>", MIP_ALPHA);
      };
      depth.customProgramCacheKey = () => "impostor-depth";
      return { geometry, material, depth, meta };
    })();
    cache.set(kind, p);
  }
  return p;
}
