import { PanelId } from "@exeora/protocol/panel-relay";
import { Hono } from "hono";
import { z } from "zod";
import type { ApiEnv } from "./api/router.js";
import { isSideappClient } from "./oauth/clients.js";
import { panelTicketResult } from "./plugin-panel-relay.js";
import { trustedPanelOrigin } from "./plugin-panel-routes.js";
import { propsOf } from "./props.js";
import { callerAddress, tooManyRequests, withinLimit } from "./rate-limit.js";

export const panelSockets = new Hono<{ Bindings: Env }>();
panelSockets.get("/panel-relay/connect", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") return c.text("Expected WebSocket upgrade.", 426);
  const origin = trustedPanelOrigin(c.req.header("Origin"));
  const panelId = PanelId.safeParse(c.req.query("panelId"));
  const ticket = c.req.query("ticket");
  if (!origin || !panelId.success || !ticket || !/^[0-9a-f]{64}$/.test(ticket))
    return c.text("Invalid panel connection.", 403);
  if (!(await withinLimit(c.env.RL_AUTH, `panel:${callerAddress(c.req.raw)}`)))
    return tooManyRequests();
  return c.env.WORKSPACE_PANEL_RELAY.getByName(panelId.data).fetch(c.req.raw);
});

export const panelPairing = new Hono<ApiEnv>();
const pairing = z
  .object({
    panelId: PanelId,
    ticket: z.string().regex(/^[0-9a-f]{64}$/),
    origin: z.string().max(512),
  })
  .strict();
panelPairing.post("/api/panel-relay/ticket", async (c) => {
  const props = propsOf(c.executionCtx);
  if (
    !props.userId ||
    !props.clientId ||
    props.deviceId ||
    !(await isSideappClient(c.env, props.clientId))
  )
    return c.json(
      { error: "forbidden", message: "A signed-in Exeora Sideapp session is required." },
      403,
    );
  const origin = trustedPanelOrigin(c.req.header("Origin"));
  const args = pairing.safeParse(await c.req.json().catch(() => null));
  if (!origin || !args.success || args.data.origin !== origin)
    return c.json({ error: "invalid_arguments" }, 400);
  const ticket = await c.env.WORKSPACE_PANEL_RELAY.getByName(args.data.panelId).exchangePairing(
    props.userId,
    args.data.ticket,
    origin,
  );
  if ("error" in ticket) return c.json(ticket, 403);
  return c.json(panelTicketResult(c.env, args.data.panelId, ticket));
});
