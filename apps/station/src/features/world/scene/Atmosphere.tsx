import { Environment, Lightformer } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";

/** Dev only: the renderer and scene on window.__mothership.three, for profiling from the console. */
function DevHandle() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __mothership?: Record<string, unknown> };
    w.__mothership = { ...w.__mothership, three: get };
  }, [get]);
  return null;
}

/**
 * The deck's light: a warm key light with shadows, soft image-based fill from a few local light
 * panels (no downloaded HDR), and post-processing so lamps, screens and status lights glow.
 * Only emissive surfaces brighter than 1 bloom (see materials.ts GLOW).
 *
 * Kept deliberately cheap: one fixed composer (swapping effects recompiles shaders and stalls), no
 * MSAA or ambient occlusion, and no point lights (each one costs every lit material, and adding one
 * mid-game recompiles them all); glows come from emissive surfaces and bloom.
 */
export function Atmosphere() {
  return (
    <>
      <DevHandle />
      <color attach="background" args={["#05060c"]} />
      <hemisphereLight args={["#ffe2c4", "#1a1f33", 0.55]} />
      <directionalLight
        position={[-8, 18, 10]}
        intensity={2.2}
        color="#ffd9b0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-bias={-0.0008}
        shadow-normalBias={0.02}
      />
      <Environment resolution={64} frames={1}>
        {/* Ceiling light panels over the deck, and a cool fill from the windows. */}
        <Lightformer
          form="rect"
          intensity={2}
          position={[0, 6, 0]}
          rotation-x={Math.PI / 2}
          scale={[20, 12, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.6}
          color="#bcd4ff"
          position={[0, 2, 14]}
          scale={[30, 3, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.4}
          color="#ffd9b0"
          position={[-18, 2, 0]}
          rotation-y={Math.PI / 2}
          scale={[20, 3, 1]}
        />
      </Environment>
      <EffectComposer multisampling={0} enableNormalPass={false}>
        <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.7} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </>
  );
}
