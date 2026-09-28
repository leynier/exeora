import { File, Folder, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { fileIconId } from "./fileIconModel.js";

type Sources = ReadonlyMap<string, string>;

let sources: Sources | null = null;
let loading: Promise<Sources> | null = null;

/**
 * The icons' markup, loaded once and on first use: a few hundred SVGs are not
 * worth holding up the first paint of a page that may never show a file.
 * Each becomes a data URL drawn by an `<img>`, so no markup is ever injected.
 */
function loadSources(): Promise<Sources> {
  loading ??= import("./fileIcons/svgs.generated.js").then(({ FILE_ICON_SVGS }) => {
    const map = new Map<string, string>();
    for (const entry of FILE_ICON_SVGS) {
      const space = entry.indexOf(" ");
      map.set(
        entry.slice(0, space),
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent(entry.slice(space + 1))}`,
      );
    }
    sources = map;
    return map;
  });
  return loading;
}

/**
 * A file's or folder's icon, chosen by its name the way VS Code's Material
 * Icon Theme chooses it: a TypeScript file looks like one, `src` looks like a
 * source folder. Until the icons have loaded, the plain outline stands in.
 */
export function FileIcon({
  name,
  kind = "file",
  open = false,
  size = "md",
  className = "",
}: {
  /** The file or folder's name, or its path: only the last segment counts. */
  name: string;
  kind?: "file" | "directory";
  /** For a folder: whether it is expanded. */
  open?: boolean;
  /** `sm` for a tab, `md` for a row. */
  size?: "sm" | "md";
  className?: string;
}) {
  const [loaded, setLoaded] = useState(sources);
  useEffect(() => {
    if (!loaded) void loadSources().then(setLoaded);
  }, [loaded]);

  const classes = `${size === "sm" ? "size-3.5" : "size-4"} shrink-0 ${className}`;
  const src = loaded?.get(fileIconId(name, kind, open));
  if (!src) {
    const Outline = kind === "directory" ? (open ? FolderOpen : Folder) : File;
    return <Outline aria-hidden="true" className={`text-foreground-faint ${classes}`} />;
  }
  return <img src={src} alt="" aria-hidden="true" draggable={false} className={classes} />;
}
