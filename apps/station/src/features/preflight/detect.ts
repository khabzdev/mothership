/** The files a deck's checks are read from; nothing else in the repo is looked at. */
export const SNAPSHOT_FILES: readonly string[] = [
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "vite.config.ts",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "Makefile",
];

/** File name → contents; a missing file is undefined (binary lockfiles may be ""). */
export type RepoSnapshot = Record<string, string | undefined>;

interface Found {
  name: string;
  command: string;
}

/** Fast checks first: a typo should fail in seconds, not after the build. */
const ORDER = ["typecheck", "vet", "lint", "check", "test", "build"];

function packageManager(snap: RepoSnapshot): (script: string) => string {
  if (snap["pnpm-lock.yaml"] !== undefined) return (s) => `pnpm run ${s}`;
  if (snap["yarn.lock"] !== undefined) return (s) => `yarn ${s}`;
  if (snap["bun.lock"] !== undefined || snap["bun.lockb"] !== undefined) {
    return (s) => `bun run ${s}`;
  }
  return (s) => `npm run ${s}`;
}

function fromPackageJson(snap: RepoSnapshot): Found[] {
  const raw = snap["package.json"];
  if (raw === undefined) return [];
  let pkg: unknown;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof pkg !== "object" || pkg === null) return [];
  const p = pkg as Record<string, unknown>;
  const has = (key: string, dep: string) =>
    typeof p[key] === "object" && p[key] !== null && dep in (p[key] as object);
  const found: Found[] = [];
  if (has("devDependencies", "vite-plus") || has("dependencies", "vite-plus")) {
    found.push({ name: "check", command: "vp check" }, { name: "test", command: "vp test" });
  }
  const scripts = typeof p.scripts === "object" && p.scripts !== null ? p.scripts : {};
  const run = packageManager(snap);
  for (const name of ["typecheck", "lint", "check", "test", "build"]) {
    if (name in scripts) found.push({ name, command: run(name) });
  }
  return found;
}

function fromCargo(snap: RepoSnapshot): Found[] {
  return snap["Cargo.toml"] === undefined
    ? []
    : [
        { name: "check", command: "cargo check" },
        { name: "test", command: "cargo test" },
      ];
}

function fromGo(snap: RepoSnapshot): Found[] {
  return snap["go.mod"] === undefined
    ? []
    : [
        { name: "vet", command: "go vet ./..." },
        { name: "test", command: "go test ./..." },
      ];
}

function fromPython(snap: RepoSnapshot): Found[] {
  const raw = snap["pyproject.toml"];
  if (raw === undefined) return [];
  const found: Found[] = [];
  if (/^\[tool\.ruff\b/m.test(raw)) found.push({ name: "lint", command: "ruff check" });
  if (/^\[tool\.pytest\b/m.test(raw)) found.push({ name: "test", command: "pytest" });
  return found;
}

function fromMakefile(snap: RepoSnapshot): Found[] {
  const raw = snap.Makefile;
  if (raw === undefined) return [];
  return ["lint", "test"]
    .filter((target) => new RegExp(`^${target}\\s*:`, "m").test(raw))
    .map((target) => ({ name: target, command: `make ${target}` }));
}

/** The checks a repo already knows how to run, fastest first, one per name. */
export function detectChecks(snap: RepoSnapshot): Found[] {
  const all = [
    ...fromPackageJson(snap),
    ...fromCargo(snap),
    ...fromGo(snap),
    ...fromPython(snap),
    ...fromMakefile(snap),
  ];
  const seen = new Set<string>();
  const unique = all.filter((c) => !seen.has(c.name) && !!seen.add(c.name));
  return unique.sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
}
