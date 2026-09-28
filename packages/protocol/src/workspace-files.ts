import { z } from "zod";

/**
 * The Explorer: one level of the tree at a time, a file's content with a
 * token that says which version it was, and the edits an editor makes.
 * Announced by a CLI as `workspace-v2`, together with search.
 */

const path = z.string().min(1).max(4_096);
const paths = z.array(path).min(1).max(100);

/** Largest content `file_write` takes, in bytes of UTF-8. */
export const MAX_FILE_WRITE_BYTES = 1_000_000;
/** How many entries `tree` lists in one directory before it says it stopped. */
export const MAX_TREE_ENTRIES = 2_000;

export const FileTreeEntry = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["file", "directory", "symlink"]),
  size: z.number().int().min(0).optional(),
  /** Matched by `.gitignore`; always false outside a repository. */
  ignored: z.boolean(),
});

export type FileTreeEntry = z.infer<typeof FileTreeEntry>;

export const FileTree = z.object({
  kind: z.literal("tree"),
  path: z.string(),
  /** Directories first, then files, each ordered without regard to case. */
  entries: z.array(FileTreeEntry),
  truncated: z.boolean(),
});

export type FileTree = z.infer<typeof FileTree>;

export const FileContent = z.object({
  kind: z.literal("file"),
  path: z.string(),
  content: z.string(),
  encoding: z.enum(["text", "base64"]),
  /** Hex sha256 of the whole file; `file_write` compares it before writing. */
  token: z.string(),
  size: z.number().int().min(0),
  truncated: z.boolean(),
  /** A NUL in the first 8 KB. Text content is empty for such a file. */
  binary: z.boolean(),
  /** By extension, for what the dashboard previews: images, svg, pdf. */
  mime: z.string().nullable(),
});

export type FileContent = z.infer<typeof FileContent>;

export const FileWritten = z.object({
  kind: z.literal("file_write"),
  path: z.string(),
  /** `conflict` when the file on disk was not the version `expectedToken` named; nothing was written. */
  status: z.enum(["written", "conflict"]),
  /** Of what is on disk now. */
  token: z.string(),
});

export type FileWritten = z.infer<typeof FileWritten>;

export const FILE_READ_ACTIONS = [
  z.object({
    action: z.literal("tree"),
    path: path.default("."),
    showIgnored: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("file_read"),
    path,
    encoding: z.enum(["text", "base64"]).default("text"),
  }),
] as const;

export const FILE_MUTATION_ACTIONS = [
  z.object({
    action: z.literal("file_write"),
    path,
    content: z.string().max(MAX_FILE_WRITE_BYTES),
    expectedToken: z.string().max(64).optional(),
    /** Whether a file that is not there is made; false answers a save of a deleted file with an error. */
    create: z.boolean().default(true),
  }),
  z.object({ action: z.literal("file_create"), path, type: z.enum(["file", "directory"]) }),
  z.object({
    action: z.literal("file_rename"),
    from: path,
    to: path,
    overwrite: z.boolean().default(false),
  }),
  /** Each path into the directory `to`, keeping its name. */
  z.object({
    action: z.literal("file_move"),
    paths,
    to: path,
    overwrite: z.boolean().default(false),
  }),
  z.object({ action: z.literal("file_delete"), paths }),
  z.object({ action: z.literal("file_duplicate"), path }),
] as const;

export const FILE_VALUES = [FileTree, FileContent, FileWritten] as const;
