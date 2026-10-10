// Downloads the KayKit (CC0, by Kay Lousberg) models Mothership uses into public/models.
// Pinned to exact commits so builds are reproducible. Run: vp run assets
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "models");
const raw = (repo, sha, path) =>
  `https://raw.githubusercontent.com/KayKit-Game-Assets/${repo}/${sha}/${path}`;

const SPACE = {
  repo: "KayKit-Space-Base-Bits-1.0",
  sha: "6dfbcac9927d06283752c4defd4882cfe0d29666",
  dir: "addons/kaykit_space_base_bits/Assets/gltf",
  files: ["spacebits_texture.png"],
  models: [
    "basemodule_A",
    "basemodule_B",
    "basemodule_C",
    "basemodule_garage",
    "cargo_A",
    "cargo_A_stacked",
    "cargo_B",
    "containers_A",
    "containers_B",
    "lander_A",
    "landingpad_large",
    "lights",
    "rock_A",
    "rocks_A",
    "solarpanel",
    "structure_low",
    "structure_tall",
    "spacetruck",
    "drill_structure",
    "basemodule_D",
    "basemodule_E",
    "cargodepot_A",
    "landingpad_small",
    "lander_B",
    "rock_B",
    "rocks_B",
    "roofmodule_solarpanels",
    "spacetruck_trailer",
    "terrain_low",
    "terrain_tall",
    "terrain_slope",
    "terrain_slope_inner_corner",
    "terrain_slope_outer_corner",
    "terrain_mining",
    "tunnel_straight_A",
    "windturbine_low",
    "windturbine_tall",
  ],
  out: "space-base",
};

const FURNITURE = {
  repo: "KayKit-Furniture-Bits-1.0",
  sha: "96d5930a8dbdb363409bbc2d3341718b00e17c9c",
  dir: "addons/kaykit_furniture_bits/Assets/gltf",
  files: ["furniturebits_texture.png"],
  models: [
    "armchair",
    "armchair_pillows",
    "book_set",
    "cabinet_medium",
    "cabinet_medium_decorated",
    "cabinet_small",
    "cactus_medium_A",
    "cactus_medium_B",
    "cactus_small_A",
    "chair_A",
    "chair_B",
    "chair_C",
    "chair_stool",
    "couch",
    "couch_pillows",
    "lamp_standing",
    "lamp_table",
    "pictureframe_large_A",
    "pictureframe_large_B",
    "pictureframe_medium",
    "rug_oval_A",
    "rug_rectangle_A",
    "rug_rectangle_stripes_A",
    "shelf_A_big",
    "shelf_B_large",
    "shelf_B_large_decorated",
    "table_low",
    "table_medium",
    "table_medium_long",
    "table_small",
  ],
  out: "furniture",
};

const CREW = {
  repo: "KayKit-Character-Pack-Adventures-1.0",
  sha: "672074b73ba276876a19e8816ecdc5241817ab47",
  dir: "addons/kaykit_character_pack_adventures/Characters/gltf",
  files: ["Knight.glb", "Barbarian.glb", "Mage.glb", "Rogue.glb", "Rogue_Hooded.glb"],
  out: "crew",
};

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, path) {
  if (await exists(path)) return false;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
  return true;
}

const jobs = [];
for (const name of SPACE.models) {
  for (const ext of [".gltf", ".bin"]) {
    jobs.push([
      raw(SPACE.repo, SPACE.sha, `${SPACE.dir}/${name}${ext}`),
      join(root, SPACE.out, name + ext),
    ]);
  }
}
for (const file of SPACE.files)
  jobs.push([raw(SPACE.repo, SPACE.sha, `${SPACE.dir}/${file}`), join(root, SPACE.out, file)]);
jobs.push([
  raw(SPACE.repo, SPACE.sha, "addons/kaykit_space_base_bits/Assets/LICENSE.txt"),
  join(root, SPACE.out, "License.txt"),
]);
for (const name of FURNITURE.models) {
  for (const ext of [".gltf", ".bin"]) {
    jobs.push([
      raw(FURNITURE.repo, FURNITURE.sha, `${FURNITURE.dir}/${name}${ext}`),
      join(root, FURNITURE.out, name + ext),
    ]);
  }
}
for (const file of FURNITURE.files) {
  jobs.push([
    raw(FURNITURE.repo, FURNITURE.sha, `${FURNITURE.dir}/${file}`),
    join(root, FURNITURE.out, file),
  ]);
}
for (const file of CREW.files)
  jobs.push([raw(CREW.repo, CREW.sha, `${CREW.dir}/${file}`), join(root, CREW.out, file)]);

let fetched = 0;
await Promise.all(
  jobs.map(async ([url, path]) => (fetched += (await download(url, path)) ? 1 : 0)),
);
console.log(
  `KayKit assets ready in public/models (${fetched} downloaded, ${jobs.length - fetched} cached)`,
);
