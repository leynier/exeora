import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EDIT_ANCHOR_OLD, HEAVY } from "./config.js";

/**
 * Corpora for the two suites, generated here for both engines.
 *
 * The Rust example never builds a fixture: it is handed a path. That is the
 * only way the two engines can be shown the same bytes, and it keeps the
 * content generator from having to exist twice and drift.
 *
 * Every file is written in order rather than through `Promise.all`. On a
 * directory small enough to be a linear one, readdir hands entries back in
 * creation order, so a race between writes moves where a walk hits its
 * thousand-entry cap and the two engines stop listing the same files.
 */

const WORDS = ["alpha", "bravo", "cargo", "delta", "echo", "fox", "gamma", "hotel"] as const;
const BEACON_KEYWORDS = ["zeta", "omega", "kappa", "sigma"] as const;

function word(index: number): string {
  return WORDS[index % WORDS.length] ?? WORDS[0];
}

function beacon(index: number): string {
  return BEACON_KEYWORDS[index % BEACON_KEYWORDS.length] ?? BEACON_KEYWORDS[0];
}

export async function createCoreFixture(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, "src"));
  const body = 'fn indexed_symbol() { println!("exeora benchmark"); }\n'.repeat(128);
  for (let index = 0; index < 128; index++) {
    await writeFile(join(root, `src/module-${pad(index, 3)}.rs`), body);
  }
  return root;
}

export async function createHeavyFixture(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await writeCorpus(root);
  await writeBigFiles(root);
  await writeMinified(root);
  await writeBlobs(root);
  await writeStdoutSource(root);
  return root;
}

// ---------------------------------------------------------------------------

/** 1,200 source-shaped files over 48 directories: what a real repository walk hits. */
async function writeCorpus(root: string): Promise<void> {
  let unitIndex = 0;

  for (let pkg = 0; pkg < HEAVY.packages; pkg++) {
    for (let module = 0; module < HEAVY.modules; module++) {
      const directory = join(root, "corpus", `pkg-${pad(pkg, 2)}`, `mod-${module}`);
      await mkdir(directory, { recursive: true });
      for (let unit = 0; unit < HEAVY.units; unit++) {
        await writeFile(join(directory, `unit-${pad(unit, 2)}.rs`), unitContent(unitIndex));
        unitIndex++;
      }
    }
  }
}

function unitContent(index: number): string {
  const lines = [`// generated unit ${index}`];
  for (let line = 1; line < HEAVY.unitLines; line++) {
    const salt = (index * 131 + line * 17) % 997;
    lines.push(
      `    let ${word(salt)}_${salt} = dispatch(state, ${salt}, "payload-${pad(line, 3)}");`,
    );
  }
  if (index % HEAVY.beaconEvery === 0) {
    const keyword = beacon(index / HEAVY.beaconEvery);
    lines[10] = `    let ${keyword}_${pad(index % 1000, 3)}_beacon = compute();`;
  }
  return `${lines.join("\n")}\n`;
}

/** One 8 MB file to read, and one 2 MB file to edit plus its pristine twin. */
async function writeBigFiles(root: string): Promise<void> {
  await mkdir(join(root, "big"), { recursive: true });
  const block = repeatedBlock();

  const haystack = block.repeat(HEAVY.haystackLines / BLOCK_LINES);
  const blocks = HEAVY.editableLines / BLOCK_LINES;
  const anchorAt = HEAVY.editableAnchorLine / BLOCK_LINES;
  const editable = `${block.repeat(anchorAt)}${EDIT_ANCHOR_OLD}\n${block.repeat(blocks - anchorAt)}`;

  await writeFile(join(root, "big/haystack.rs"), haystack);
  await writeFile(join(root, "big/editable.rs"), editable);
  // edit_file rewrites its target, so every iteration starts from this copy.
  await writeFile(join(root, "big/editable-pristine.rs"), editable);
}

const BLOCK_LINES = 1_000;

/** Fixed-width fields, so line count times 68 bytes is the file size. */
function repeatedBlock(): string {
  const lines: string[] = [];
  for (let line = 0; line < BLOCK_LINES; line++) {
    const salt = (line * 37) % 997;
    const name = word(salt).padEnd(5, "_");
    lines.push(
      `    state.push(Node::new(${pad(salt, 3)}, "${name}-${pad(line, 4)}", Span::new(${pad(salt, 3)}, ${pad(line, 4)})));`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Twenty 100 KB lines: the shape that makes line-oriented search awkward. */
async function writeMinified(root: string): Promise<void> {
  await mkdir(join(root, "minified"), { recursive: true });
  const marker = "runtime_beacon_marker";
  const chunk = "var _0x4a=function(a,b){return a+b;};";
  const filler = chunk.repeat(Math.ceil(HEAVY.minifiedLineBytes / chunk.length));
  const line = filler.slice(0, HEAVY.minifiedLineBytes - marker.length) + marker;
  await writeFile(join(root, "minified/bundle.js"), `${line}\n`.repeat(HEAVY.minifiedLines));
}

/** 4 MB of binary next to one text file: a repository with assets checked in. */
async function writeBlobs(root: string): Promise<void> {
  await mkdir(join(root, "blobs"), { recursive: true });
  for (let index = 0; index < HEAVY.blobs; index++) {
    await writeFile(join(root, `blobs/blob-${index}.bin`), blob(index));
  }
  const text = ["first blob_adjacent_marker", "second blob_adjacent_marker", "third one"].join(
    "\n",
  );
  await writeFile(join(root, "blobs/needle.txt"), `${text}\n`);
}

function blob(seed: number): Buffer {
  const bytes = Buffer.allocUnsafe(HEAVY.blobBytes);
  let state = (seed + 1) * 2_654_435_761;
  for (let index = 0; index < bytes.length; index++) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    bytes[index] = (state >>> 16) & 0xff;
  }
  // Where a PNG or an ELF header puts one, and where both engines decide.
  bytes[4] = 0;
  return bytes;
}

/** 700 KB: inside run_command's read buffer, well past the output it may return. */
async function writeStdoutSource(root: string): Promise<void> {
  await mkdir(join(root, "streams"), { recursive: true });
  const line = `${"streamed output line for the run_command capture path".padEnd(69, ".")}\n`;
  await writeFile(
    join(root, "streams/stdout-700k.txt"),
    line.repeat(Math.ceil(HEAVY.stdoutBytes / line.length)),
  );
}

function pad(value: number, width: number): string {
  return value.toString().padStart(width, "0");
}
