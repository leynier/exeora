import { and, eq, isNotNull, lt, ne, or } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import "../env.js";
import { isSpriteNameOfThisGateway } from "./access.js";
import { deleteSprite, listSprites } from "./sprites.js";

/**
 * The five-minute sweep behind Exeora Cloud.
 *
 * Provisioning runs on Durable Object alarms, which the runtime retries; what
 * this covers is the rest. A chain of alarms can still be lost, a destroy can
 * fail past its retries, and a Sprite can outlive its rows when a request died
 * between creating one and recording it. Each case is cheap to notice here and
 * expensive to leave alone: a forgotten Sprite is a bill.
 */

/** Left in `creating` this long without a change: the alarm chain probably died. */
const STUCK_AFTER_MS = 20 * 60_000;
/** This long: something is wrong beyond a lost alarm, and the person should know. */
const GIVE_UP_AFTER_MS = 45 * 60_000;
const DESTROY_RETRY_AFTER_MS = 10 * 60_000;
/** A Sprite younger than this may belong to a request still writing its rows. */
const ORPHAN_GRACE_MS = 10 * 60_000;

export async function reconcileCloud(
  env: Pick<Env, "DB" | "SPRITES_TOKEN" | "CLOUD_MACHINE" | "CLOUD_SPRITE_PREFIX">,
  options: { fetcher?: typeof fetch; now?: number } = {},
): Promise<{
  poked: number;
  errored: number;
  retriedDestroys: number;
  finishedDeletions: number;
  orphansDeleted: number;
}> {
  const summary = {
    poked: 0,
    errored: 0,
    retriedDestroys: 0,
    finishedDeletions: 0,
    orphansDeleted: 0,
  };
  if (!env.SPRITES_TOKEN) return summary;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now();
  const database = db(env);

  const creating = await database
    .select({
      deviceId: schema.cloudMachines.deviceId,
      updatedAt: schema.cloudMachines.updatedAt,
    })
    .from(schema.cloudMachines)
    .where(
      and(
        eq(schema.cloudMachines.status, "creating"),
        lt(schema.cloudMachines.updatedAt, new Date(now - STUCK_AFTER_MS)),
      ),
    )
    .all();
  for (const row of creating) {
    if (now - row.updatedAt.getTime() > GIVE_UP_AFTER_MS) {
      await database
        .update(schema.cloudMachines)
        .set({
          status: "error",
          step: null,
          error: "Provisioning timed out. Retry to try again.",
          updatedAt: new Date(now),
        })
        .where(eq(schema.cloudMachines.deviceId, row.deviceId))
        .run();
      summary.errored += 1;
    } else {
      await env.CLOUD_MACHINE.getByName(row.deviceId).poke();
      summary.poked += 1;
    }
  }

  const destroying = await database
    .select({
      deviceId: schema.cloudMachines.deviceId,
      userId: schema.cloudMachines.userId,
      projectId: schema.cloudMachines.projectId,
      workspaceId: schema.cloudMachines.workspaceId,
      spriteName: schema.cloudMachines.spriteName,
    })
    .from(schema.cloudMachines)
    .where(
      and(
        eq(schema.cloudMachines.status, "destroying"),
        lt(schema.cloudMachines.updatedAt, new Date(now - DESTROY_RETRY_AFTER_MS)),
      ),
    )
    .all();
  for (const { deviceId, ...seed } of destroying) {
    await env.CLOUD_MACHINE.getByName(deviceId).destroy({ deviceId, ...seed });
    summary.retriedDestroys += 1;
  }

  // A project whose removal was accepted but whose machines were not all
  // told, and a machine whose device was revoked without its destruction
  // being asked for: the mark and the revocation are the intent, and every
  // machine still standing is taken down here, the main one last as the
  // removal itself does it. A revoked cloud device is a machine nobody can
  // reach that still costs money; there is no other thing it could mean.
  const leftBehind = await database
    .select({
      deviceId: schema.cloudMachines.deviceId,
      userId: schema.cloudMachines.userId,
      projectId: schema.cloudMachines.projectId,
      workspaceId: schema.cloudMachines.workspaceId,
      spriteName: schema.cloudMachines.spriteName,
    })
    .from(schema.cloudMachines)
    .innerJoin(schema.devices, eq(schema.devices.id, schema.cloudMachines.deviceId))
    .innerJoin(
      schema.cloudProjects,
      eq(schema.cloudProjects.projectId, schema.cloudMachines.projectId),
    )
    .where(
      and(
        ne(schema.cloudMachines.status, "destroying"),
        or(isNotNull(schema.cloudProjects.deletingAt), isNotNull(schema.devices.revokedAt)),
      ),
    )
    .all();
  for (const { deviceId, ...seed } of leftBehind.sort(
    (a, b) => Number(a.workspaceId === null) - Number(b.workspaceId === null),
  )) {
    await env.CLOUD_MACHINE.getByName(deviceId).destroy({ deviceId, ...seed });
    summary.finishedDeletions += 1;
  }

  // Orphans: Sprites of exactly this gateway's naming, that no row claims.
  // Rows in any status count as a claim, including `destroying`, whose object
  // deletes its own. The prefix narrows the listing; the full shape decides.
  const prefix = `${env.CLOUD_SPRITE_PREFIX || "exeora"}-`;
  const known = new Set(
    (
      await database
        .select({ name: schema.cloudMachines.spriteName })
        .from(schema.cloudMachines)
        .all()
    ).map((row) => row.name),
  );
  const config = { token: env.SPRITES_TOKEN };
  for (const sprite of await listSprites(config, fetcher, { prefix })) {
    if (!isSpriteNameOfThisGateway(env, sprite.name) || known.has(sprite.name)) continue;
    const createdAt = Date.parse((sprite as { created_at?: string }).created_at ?? "");
    if (Number.isFinite(createdAt) && now - createdAt < ORPHAN_GRACE_MS) continue;
    await deleteSprite(config, sprite.name, fetcher);
    summary.orphansDeleted += 1;
  }

  return summary;
}
