import { z } from "zod";

/**
 * Search and replace across the checkout. Announced by a CLI as
 * `workspace-v2`, together with the Explorer.
 */

const path = z.string().min(1).max(4_096);

export const MAX_SEARCH_RESULTS = 2_000;
export const MAX_SEARCH_PER_FILE = 100;
export const MAX_REPLACE_TARGETS = 500;

const query = {
  query: z.string().min(1).max(1_000),
  regex: z.boolean().default(false),
  caseSensitive: z.boolean().default(false),
  wholeWord: z.boolean().default(false),
};

export const SearchMatch = z.object({
  /** 1-based. */
  line: z.number().int().min(1),
  /** 1-based, in characters. */
  column: z.number().int().min(1),
  /** In characters. */
  length: z.number().int().min(0),
  /** The line, or a window of at most 200 characters of it around the match. */
  preview: z.string(),
  /** Where the match starts inside `preview`, in characters. */
  previewOffset: z.number().int().min(0),
});

export type SearchMatch = z.infer<typeof SearchMatch>;

export const SearchFile = z.object({
  path: z.string(),
  /** Hex sha256 of the file as searched; `replace` refuses a file that changed since. */
  token: z.string(),
  matches: z.array(SearchMatch),
  /** More matches in this file than `maxPerFile`. */
  truncated: z.boolean(),
});

export type SearchFile = z.infer<typeof SearchFile>;

export const SearchResult = z.object({
  kind: z.literal("search"),
  files: z.array(SearchFile),
  totalMatches: z.number().int().min(0),
  /** Stopped at `maxResults`; a replace-all over these would miss some. */
  truncated: z.boolean(),
  filesSearched: z.number().int().min(0),
  /** Binary, over the size cap, or unreadable. */
  filesSkipped: z.number().int().min(0),
});

export type SearchResult = z.infer<typeof SearchResult>;

export const ReplaceFile = z.object({
  path: z.string(),
  replaced: z.number().int().min(0),
  /** `conflict`: changed since it was searched; `missing`: gone; `skipped`: nothing matched. */
  status: z.enum(["ok", "conflict", "missing", "skipped"]),
});

export const ReplaceResult = z.object({
  kind: z.literal("replace"),
  files: z.array(ReplaceFile),
  replaced: z.number().int().min(0),
  /** Files that were not written, for any reason but having nothing to replace. */
  skipped: z.number().int().min(0),
});

export type ReplaceResult = z.infer<typeof ReplaceResult>;

export const SEARCH_READ_ACTIONS = [
  z.object({
    action: z.literal("search"),
    ...query,
    /** Comma-separated globs, relative to the project root. */
    include: z.string().max(1_000).optional(),
    exclude: z.string().max(1_000).optional(),
    includeIgnored: z.boolean().default(false),
    /** A directory to search under, relative to the project root. */
    path: path.optional(),
    maxResults: z.number().int().min(1).max(MAX_SEARCH_RESULTS).default(500),
    maxPerFile: z.number().int().min(1).max(MAX_SEARCH_PER_FILE).default(50),
  }),
] as const;

export const SEARCH_MUTATION_ACTIONS = [
  z.object({
    action: z.literal("replace"),
    ...query,
    /** With `regex`, `$1` and `${name}` stand for captures. */
    replacement: z.string().max(10_000),
    /** An all-caps match is replaced in caps, a Capitalized one capitalized. */
    preserveCase: z.boolean().default(false),
    targets: z
      .array(
        z.object({
          path,
          token: z.string().max(64),
          /** Only these lines (1-based); every match in the file otherwise. */
          lines: z.array(z.number().int().min(1)).max(MAX_SEARCH_PER_FILE).optional(),
        }),
      )
      .min(1)
      .max(MAX_REPLACE_TARGETS),
  }),
] as const;

export const SEARCH_VALUES = [SearchResult, ReplaceResult] as const;
