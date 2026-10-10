import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  SRGBColorSpace,
  Vector3,
  type Texture,
} from "three";
import { EARTH, MOON, PLANET_TEXTURES, SUN, SUN_DIRECTION, type Body } from "../sky";
import { GLOW } from "./materials";

// The orbit sky: Earth below the island's north side, the Moon beside it and the Sun where the key
// light comes from. It rides along with the camera (no rotation) so the bodies never parallax as you
// walk. No lights of its own: Earth and the Moon shade themselves from SUN_DIRECTION in small
// shaders, and the Sun's disc is emissive over 1 so the existing bloom halos it.

const at = (b: Body) => new Vector3(...b.direction).multiplyScalar(b.distance);
const EARTH_AT = at(EARTH);
const MOON_AT = at(MOON);
const SUN_AT = at(SUN);
const SUN_UNIFORM = { value: new Vector3(...SUN_DIRECTION) };
/** Earth's axis, tipped so the deck looks down on its mid-latitudes rather than the pole. */
const EARTH_TILT: [number, number, number] = [-0.3, 0, 0.41];
const SUN_COLOR = new Color("#fff1d6").multiplyScalar(GLOW);
const GLARE_COLOR = new Color("#ffd9b0").multiplyScalar(1.1);
const ATMOSPHERE = "vec3(0.32, 0.56, 1.0)";

useTexture.preload(Object.values(PLANET_TEXTURES));

// World-space normal and view vector, so lighting follows SUN_DIRECTION whatever the mesh's spin.
const VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vToCamera;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vToCamera = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/** A touch less saturation and contrast, so the photos sit with the low-poly kit. */
const SOFTEN = /* glsl */ `
  vec3 soften(vec3 c) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(l), c, 0.8) * 0.9 + 0.02;
  }
`;

// Day map lit by the Sun, city lights only on the night side, and a blue haze toward the limb.
const EARTH_FRAGMENT = /* glsl */ `
  uniform sampler2D day;
  uniform sampler2D night;
  uniform vec3 sun;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vToCamera;
  ${SOFTEN}
  void main() {
    vec3 n = normalize(vNormal);
    float light = dot(n, sun);
    vec3 ground = soften(texture2D(day, vUv).rgb) * (0.04 + max(light, 0.0));
    float dark = 1.0 - smoothstep(-0.15, 0.1, light);
    vec3 cities = texture2D(night, vUv).rgb * vec3(1.0, 0.82, 0.55) * 0.9 * dark;
    float rim = pow(1.0 - max(dot(n, normalize(vToCamera)), 0.0), 3.0);
    vec3 haze = ${ATMOSPHERE} * rim * (0.1 + 0.6 * smoothstep(-0.2, 0.4, light));
    gl_FragColor = vec4(ground + cities + haze, 1.0);
    #include <colorspace_fragment>
  }
`;

// White clouds from the map's alpha, shaded like the ground below them.
const CLOUDS_FRAGMENT = /* glsl */ `
  uniform sampler2D clouds;
  uniform vec3 sun;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vToCamera;
  void main() {
    float light = dot(normalize(vNormal), sun);
    float shade = 0.03 + 0.85 * max(light, 0.0);
    gl_FragColor = vec4(vec3(shade), texture2D(clouds, vUv).a * 0.85);
    #include <colorspace_fragment>
  }
`;

// The atmosphere: the far side of a slightly larger shell, added on, strongest where it meets
// Earth's limb and gone by the shell's own edge; brighter on the day side.
const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 sun;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vToCamera;
  void main() {
    vec3 n = normalize(vNormal);
    float depth = -dot(n, normalize(vToCamera));
    float glow = pow(smoothstep(0.0, 0.28, depth), 2.0);
    float day = 0.2 + 0.8 * smoothstep(-0.3, 0.4, dot(n, sun));
    gl_FragColor = vec4(${ATMOSPHERE} * glow * day * 0.8, 1.0);
    #include <colorspace_fragment>
  }
`;

const MOON_FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 sun;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vToCamera;
  ${SOFTEN}
  void main() {
    float light = max(dot(normalize(vNormal), sun), 0.0);
    gl_FragColor = vec4(soften(texture2D(map, vUv).rgb) * (0.02 + 0.95 * light), 1.0);
    #include <colorspace_fragment>
  }
`;

let glarePicture: CanvasTexture | undefined;

/** A soft round glow, bright at the centre and fading out to nothing. */
function glare(): CanvasTexture {
  if (glarePicture) return glarePicture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const c = canvas.getContext("2d")!;
  const fade = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  fade.addColorStop(0, "rgba(255,255,255,1)");
  fade.addColorStop(0.12, "rgba(255,255,255,0.45)");
  fade.addColorStop(0.4, "rgba(255,255,255,0.1)");
  fade.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = fade;
  c.fillRect(0, 0, 128, 128);
  glarePicture = new CanvasTexture(canvas);
  glarePicture.colorSpace = SRGBColorSpace;
  return glarePicture;
}

/** Earth, the Moon and the Sun around the deck. */
export function Sky() {
  const sky = useRef<Group>(null);
  const earth = useRef<Mesh>(null);
  const clouds = useRef<Mesh>(null);
  const maps = useTexture(PLANET_TEXTURES);
  const uniforms = useMemo(() => {
    for (const map of [maps.day, maps.night, maps.moon] as Texture[])
      map.colorSpace = SRGBColorSpace;
    return {
      earth: { day: { value: maps.day }, night: { value: maps.night }, sun: SUN_UNIFORM },
      clouds: { clouds: { value: maps.clouds }, sun: SUN_UNIFORM },
      atmosphere: { sun: SUN_UNIFORM },
      moon: { map: { value: maps.moon }, sun: SUN_UNIFORM },
    };
  }, [maps]);

  useFrame(({ camera }, dt) => {
    sky.current?.position.copy(camera.position);
    if (earth.current) earth.current.rotation.y += EARTH.turn * dt;
    if (clouds.current) clouds.current.rotation.y += EARTH.drift * dt;
  });

  return (
    <group ref={sky}>
      <group position={EARTH_AT} rotation={EARTH_TILT}>
        <mesh ref={earth}>
          <sphereGeometry args={[EARTH.radius, 64, 48]} />
          <shaderMaterial
            vertexShader={VERTEX}
            fragmentShader={EARTH_FRAGMENT}
            uniforms={uniforms.earth}
          />
        </mesh>
        <mesh ref={clouds}>
          <sphereGeometry args={[EARTH.radius * EARTH.clouds, 64, 48]} />
          <shaderMaterial
            vertexShader={VERTEX}
            fragmentShader={CLOUDS_FRAGMENT}
            uniforms={uniforms.clouds}
            transparent
            depthWrite={false}
          />
        </mesh>
        <mesh>
          <sphereGeometry args={[EARTH.radius * EARTH.atmosphere, 64, 48]} />
          <shaderMaterial
            vertexShader={VERTEX}
            fragmentShader={ATMOSPHERE_FRAGMENT}
            uniforms={uniforms.atmosphere}
            side={BackSide}
            blending={AdditiveBlending}
            transparent
            depthWrite={false}
          />
        </mesh>
      </group>

      <mesh position={MOON_AT} rotation-y={-1.2}>
        <sphereGeometry args={[MOON.radius, 32, 24]} />
        <shaderMaterial
          vertexShader={VERTEX}
          fragmentShader={MOON_FRAGMENT}
          uniforms={uniforms.moon}
        />
      </mesh>

      <mesh position={SUN_AT}>
        <sphereGeometry args={[SUN.radius, 32, 16]} />
        <meshBasicMaterial color={SUN_COLOR} toneMapped={false} />
      </mesh>
      <sprite position={SUN_AT} scale={SUN.radius * SUN.glare * 2}>
        <spriteMaterial
          map={glare()}
          color={GLARE_COLOR}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
    </group>
  );
}
