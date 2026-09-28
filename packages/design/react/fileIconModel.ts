import {
  DEFAULT_ICONS,
  FILE_EXTENSIONS,
  FILE_NAMES,
  FOLDER_NAMES,
} from "./fileIcons/names.generated.js";

type Maps = {
  extensions: ReadonlyMap<string, string>;
  names: ReadonlyMap<string, string>;
  folders: ReadonlyMap<string, readonly [closed: string, open: string]>;
};

let maps: Maps | null = null;

function pairs(list: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of list.split(",")) {
    const colon = item.indexOf(":");
    if (colon > 0) map.set(item.slice(0, colon), item.slice(colon + 1));
  }
  return map;
}

function parsed(): Maps {
  if (maps) return maps;
  const folders = new Map<string, readonly [string, string]>();
  for (const item of FOLDER_NAMES.split(",")) {
    const [name, closed, open] = item.split(":");
    if (name && closed && open) folders.set(name, [closed, open]);
  }
  maps = { extensions: pairs(FILE_EXTENSIONS), names: pairs(FILE_NAMES), folders };
  return maps;
}

/**
 * Which icon a file or folder is drawn with: the Material Icon Theme's id,
 * looked up the way VS Code does.
 *
 * A folder by its name. A file by its whole name first (`package.json`,
 * `Dockerfile`), then by its extension, the longest one the theme knows, so
 * `app.test.ts` is a test before it is TypeScript and `.dockerignore` is
 * Docker's. Names are compared lower-cased, and a path is read by its last
 * segment. Anything unknown is the plain file or folder.
 */
export function fileIconId(name: string, kind: "file" | "directory", open = false): string {
  const { extensions, names, folders } = parsed();
  const lower = baseName(name).toLowerCase();
  if (kind === "directory") {
    const icons = folders.get(lower);
    if (icons) return open ? icons[1] : icons[0];
    return open ? DEFAULT_ICONS.folderOpen : DEFAULT_ICONS.folder;
  }
  const exact = names.get(lower);
  if (exact) return exact;
  const parts = lower.split(".");
  for (let start = 1; start < parts.length; start++) {
    const icon = extensions.get(parts.slice(start).join("."));
    if (icon) return icon;
  }
  return DEFAULT_ICONS.file;
}

/** The last segment of a path, which is what an icon is chosen by. */
export function baseName(path: string): string {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}
