import { and, eq, like } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import "./env.js";
import { CLOUD_LOCATION_SLUG, locationSlug } from "./locations.js";

/**
 * The slug a workspace gets, given the one it asked for.
 *
 * A slug names one workspace of a project, and it comes from the branch. The
 * same branch can have a working copy in two locations, on the laptop and on
 * the desktop say, and both would ask for the same slug. The first keeps it;
 * the next is given the slug with its location behind it, `fix-login-desktop`,
 * so each can be named in a call and each call reaches the machine that holds
 * what it names.
 *
 * Two workspaces on the same machine asking for one slug is a different
 * thing: that is a real conflict, and it is answered as one.
 */
export type SlugChoice = { slug: string } | { conflict: true };

export async function chooseWorkspaceSlug(
  env: Pick<Env, "DB">,
  entry: {
    projectId: string;
    wanted: string;
    /** The machine that holds the workspace. Null for one being made on Exeora Cloud. */
    deviceId: string | null;
    /** The workspace asking, when it already exists: it may keep what it has. */
    workspaceId?: string | undefined;
  },
): Promise<SlugChoice> {
  const database = db(env);
  const taken = await database
    .select({
      id: schema.workspaces.id,
      slug: schema.workspaces.slug,
      deviceId: schema.workspaces.deviceId,
      defaultDevice: schema.projects.deviceId,
    })
    .from(schema.workspaces)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.workspaces.projectId))
    .where(
      and(
        eq(schema.workspaces.projectId, entry.projectId),
        like(schema.workspaces.slug, `${entry.wanted}%`),
      ),
    )
    .all();

  const own = taken.find((row) => row.id === entry.workspaceId);
  const others = taken.filter((row) => row.id !== entry.workspaceId);
  const holder = others.find((row) => row.slug === entry.wanted);
  if (!holder) return { slug: entry.wanted };

  // A workspace that was already given a suffixed slug keeps it: it asks for
  // the plain one every time it reports, and must not be renamed each time.
  if (own && own.slug !== entry.wanted && own.slug.startsWith(`${entry.wanted}-`)) {
    return { slug: own.slug };
  }

  const holderDevice = holder.deviceId ?? holder.defaultDevice;
  if (entry.deviceId !== null && holderDevice === entry.deviceId) return { conflict: true };

  const suffix = await suffixFor(env, entry.deviceId);
  const used = new Set(others.map((row) => row.slug));
  const base = `${entry.wanted.slice(0, 59 - suffix.length)}-${suffix}`;
  if (!used.has(base)) return { slug: base };
  for (let n = 2; n < 100; n += 1) {
    const tail = `-${n}`;
    const candidate = `${base.slice(0, 60 - tail.length)}${tail}`;
    if (!used.has(candidate)) return { slug: candidate };
  }
  return { conflict: true };
}

async function suffixFor(env: Pick<Env, "DB">, deviceId: string | null): Promise<string> {
  if (deviceId === null) return CLOUD_LOCATION_SLUG;
  const device = await db(env)
    .select({ name: schema.devices.name, kind: schema.devices.kind })
    .from(schema.devices)
    .where(eq(schema.devices.id, deviceId))
    .get();
  if (!device || device.kind === "cloud") return CLOUD_LOCATION_SLUG;
  return locationSlug(device.name).slice(0, 24).replace(/-+$/, "");
}
