import { randomUUID } from "node:crypto";
import { expect, type Page, type WebSocketRoute } from "@playwright/test";

/**
 * A stand-in for the gateway's Workspace relay: the socket a panel opens with
 * the ticket the simulated host hands it (`relay` in the host scenario). It
 * greets the panel, sends it commands as the public Workspace tools would,
 * and reads its replies. It checks the panel's side of the relay protocol,
 * not the gateway's.
 */

export interface RelaySocketStandIn {
  url: string;
  generation: string;
  received: Record<string, unknown>[];
  closed: { code: number | undefined; reason: string | undefined } | null;
  route: WebSocketRoute;
}

export async function relayGateway(page: Page) {
  const sockets: RelaySocketStandIn[] = [];
  await page.routeWebSocket(/\/relay-socket\?ticket=/, (route) => {
    const socket: RelaySocketStandIn = {
      url: route.url(),
      generation: randomUUID(),
      received: [],
      closed: null,
      route,
    };
    route.onMessage((message) => socket.received.push(JSON.parse(String(message))));
    route.onClose((code, reason) => {
      socket.closed = { code, reason };
    });
    sockets.push(socket);
  });

  /** The `index`-th socket the panel opened, greeted as `panelId`, once it answers. */
  const connect = async (index: number, panelId: string) => {
    await expect.poll(() => sockets.length, { timeout: 10_000 }).toBeGreaterThan(index);
    const socket = sockets[index] as RelaySocketStandIn;
    socket.route.send(
      JSON.stringify({ type: "ready", protocol: 1, panelId, generation: socket.generation }),
    );
    await expect.poll(() => socket.received.some((message) => message.type === "ready")).toBe(true);
    return socket;
  };

  /** Sends a command and returns the panel's request id for it. */
  const send = (
    socket: RelaySocketStandIn,
    panelId: string,
    operation: string,
    args: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ) => {
    const requestId = randomUUID();
    socket.route.send(
      JSON.stringify({
        type: "command",
        protocol: 1,
        panelId,
        requestId,
        generation: socket.generation,
        operation,
        args,
        deadline: Date.now() + 20_000,
        ...extra,
      }),
    );
    return requestId;
  };

  const replies = (socket: RelaySocketStandIn, requestId: string) =>
    socket.received.filter(
      (message) => message.type === "result" && message.requestId === requestId,
    );

  /** A command and its one reply's result, as the public tool would get it. */
  const call = async (
    socket: RelaySocketStandIn,
    panelId: string,
    operation: string,
    args: Record<string, unknown> = {},
  ) => {
    const requestId = send(socket, panelId, operation, args);
    await expect.poll(() => replies(socket, requestId).length, { timeout: 10_000 }).toBe(1);
    const reply = replies(socket, requestId)[0] as Record<string, unknown>;
    expect(reply).toMatchObject({ protocol: 1, generation: socket.generation });
    return reply.result as Record<string, unknown>;
  };

  return { sockets, connect, send, call, replies };
}
