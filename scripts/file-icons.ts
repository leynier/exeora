/**
 * Writes the file and folder icons the Workspace lists draw.
 *
 * Run it with `bun run icons` after changing the lists below or bumping
 * `material-icon-theme`. The output is committed, like the brand kit's: the
 * dashboard should not need the whole theme, a thousand icons, to show the
 * few hundred a repository actually has.
 *
 * The icons are the Material Icon Theme's (MIT, by Philipp Kief), the same
 * ones VS Code shows with that theme on. Which icon a name gets is the theme's
 * own mapping; this only chooses which names are worth carrying.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const THEME = join(ROOT, "node_modules", "material-icon-theme");
const OUT = join(ROOT, "packages", "design", "react", "fileIcons");

/** Extensions, longest first where one ends another (`test.ts` before `ts`). */
const EXTENSIONS = `
  gitlab-ci.yml d.ts test.ts spec.ts test.tsx spec.tsx test.js spec.js test.jsx spec.jsx stories.tsx stories.ts
  ts tsx mts cts js jsx mjs cjs json jsonc json5 md mdx markdown rs py pyi go java kt kts swift
  c h cpp hpp cc cxx cs fs rb php lua dart scala ex exs erl hs clj zig nim r jl ml elm
  sh bash zsh fish ps1 psm1 bat cmd toml yml yaml xml ini conf cfg env properties
  css scss sass less styl pcss html htm vue svelte astro sql prisma graphql gql proto
  lock dockerignore svg png jpg jpeg gif webp ico bmp avif tiff mp4 mov webm mkv avi mp3 wav ogg flac m4a
  pdf zip tar gz tgz rar 7z bz2 xz txt log csv tsv xlsx xls docx doc pptx
  woff woff2 ttf otf eot wasm diff patch tf tfvars hcl nix pem key crt cert pub asc sqlite db
  http rest ipynb tex bib vsix jar apk exe dll so wat
`;

/** Whole file names, compared lower-cased. */
const FILE_NAMES = `
  package.json package-lock.json bun.lock bun.lockb yarn.lock pnpm-lock.yaml pnpm-workspace.yaml
  tsconfig.json tsconfig.base.json jsconfig.json go.mod go.sum go.work
  pyproject.toml requirements.txt pipfile poetry.lock gemfile
  dockerfile docker-compose.yml docker-compose.yaml compose.yml compose.yaml
  makefile readme.md readme license license.md license.txt changelog.md contributing.md
  code_of_conduct.md security.md claude.md agents.md .gitignore .gitattributes .gitmodules
  .gitkeep .editorconfig .env.local .env.example .env.production .env.development .npmrc
  .nvmrc .node-version .prettierrc .prettierignore .eslintrc .eslintrc.json eslint.config.js
  eslint.config.mjs eslint.config.ts biome.json biome.jsonc vite.config.ts vite.config.js
  vitest.config.ts vitest.config.js playwright.config.ts jest.config.js jest.config.ts
  astro.config.mjs astro.config.ts next.config.js next.config.ts next.config.mjs
  tailwind.config.js tailwind.config.ts postcss.config.js postcss.config.mjs svelte.config.js
  nuxt.config.ts webpack.config.js rollup.config.js babel.config.js .babelrc wrangler.toml
  wrangler.json wrangler.jsonc vercel.json netlify.toml favicon.ico robots.txt
  deno.json deno.jsonc bunfig.toml
  drizzle.config.ts wxt.config.ts turbo.json nx.json lerna.json renovate.json
  .dev.vars jenkinsfile procfile vagrantfile cmakelists.txt
  pom.xml tsconfig.node.json tsconfig.app.json
`;

/** Folder names, compared lower-cased; each has an open and a closed icon. */
const FOLDER_NAMES = `
  src source lib libs dist build out bin public static assets images img icons fonts media
  docs doc test tests __tests__ spec e2e scripts script tools config configs .github .vscode
  .git node_modules components pages views layouts hooks api routes controllers models
  services utils util helpers types typings styles css db database migrations i18n locales
  lang apps app packages crates examples templates server client shared core middleware
  plugins fixtures mocks __mocks__ vendor target coverage logs log temp tmp .cache
  cache security auth admin store stores context contexts providers prisma graphql proto
  android ios desktop mobile web docker .docker k8s kubernetes terraform ci .husky
  .claude .changeset functions lambda queue jobs tasks emails mail audio video content
  interfaces classes constants theme themes animations .next .nuxt .astro .turbo
`;

type Manifest = {
  file: string;
  folder: string;
  folderExpanded: string;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
  iconDefinitions: Record<string, { iconPath: string }>;
};

function words(list: string): string[] {
  return [...new Set(list.split(/\s+/).filter(Boolean))];
}

/** A manifest key looked up the way VS Code does: exactly, then lower-cased. */
function lookup(map: Record<string, string>, key: string): string | undefined {
  if (map[key]) return map[key];
  const found = Object.entries(map).find(([name]) => name.toLowerCase() === key);
  return found?.[1];
}

if (!existsSync(THEME)) {
  console.error("material-icon-theme is not installed. Run `bun install` first.");
  process.exit(1);
}

const version = (
  JSON.parse(readFileSync(join(THEME, "package.json"), "utf8")) as { version: string }
).version;
const manifest = JSON.parse(
  readFileSync(join(THEME, "dist", "material-icons.json"), "utf8"),
) as Manifest;

const used = new Set<string>([manifest.file, manifest.folder, manifest.folderExpanded]);
const missing: string[] = [];

function pairs(names: string[], map: Record<string, string>): string {
  const out: string[] = [];
  for (const name of names) {
    const icon = lookup(map, name);
    if (!icon) {
      missing.push(name);
      continue;
    }
    used.add(icon);
    out.push(`${name}:${icon}`);
  }
  return out.join(",");
}

const extensions = pairs(words(EXTENSIONS), manifest.fileExtensions);
const fileNames = pairs(words(FILE_NAMES), manifest.fileNames);
const folders: string[] = [];
for (const name of words(FOLDER_NAMES)) {
  const closed = lookup(manifest.folderNames, name);
  const open = lookup(manifest.folderNamesExpanded, name);
  if (!closed || !open) {
    missing.push(`${name}/`);
    continue;
  }
  used.add(closed);
  used.add(open);
  folders.push(`${name}:${closed}:${open}`);
}

const svgs: string[] = [];
for (const id of [...used].sort()) {
  const definition = manifest.iconDefinitions[id];
  if (!definition) throw new Error(`The theme names ${id} but does not define it.`);
  const svg = readFileSync(join(THEME, "dist", definition.iconPath), "utf8")
    .replace(/\s*\n\s*/g, " ")
    .trim();
  // Refused rather than cleaned: the icons are drawn as images, but nothing
  // that is not plain drawing belongs in them, and a theme that ever ships
  // one should be looked at, not quietly edited.
  if (!/^<svg[\s>][\s\S]*<\/svg>$/.test(svg) || /<!--|<script|<foreignObject|\son\w+=/i.test(svg)) {
    throw new Error(`${definition.iconPath} is not a plain SVG drawing.`);
  }
  // One string per icon, id then markup, so each stays on a line of its own:
  // the formatter would put a long value under its key, doubling the file.
  svgs.push(`  ${JSON.stringify(`${id} ${svg}`)},`);
}

const banner = `// Generated by scripts/file-icons.ts from material-icon-theme ${version}
// (MIT, Philipp Kief). Do not edit: change the lists there and run \`bun run icons\`.
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, "names.generated.ts"),
  `${banner}
/** \`extension:icon\`, comma separated. */
export const FILE_EXTENSIONS =
  ${JSON.stringify(extensions)};

/** \`name:icon\`, comma separated, lower-cased names. */
export const FILE_NAMES =
  ${JSON.stringify(fileNames)};

/** \`name:closed:open\`, comma separated, lower-cased names. */
export const FOLDER_NAMES =
  ${JSON.stringify(folders.join(","))};

export const DEFAULT_ICONS = ${JSON.stringify({
    file: manifest.file,
    folder: manifest.folder,
    folderOpen: manifest.folderExpanded,
  })} as const;
`,
);
writeFileSync(
  join(OUT, "svgs.generated.ts"),
  `${banner}
/** Each icon as \`id <svg…>\`: the theme's icon id, a space, its markup. */
export const FILE_ICON_SVGS: readonly string[] = [
${svgs.join("\n")}
];
`,
);

spawnSync("bunx", ["biome", "format", "--write", OUT], { cwd: ROOT, stdio: "inherit" });
console.log(`${used.size} icons written to ${OUT}.`);
if (missing.length > 0)
  console.log(`Not in the theme, drawn with the default: ${missing.join(" ")}`);
