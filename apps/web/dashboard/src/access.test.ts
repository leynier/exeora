import { describe, expect, it } from "vitest";
import { chosenListClients, connectedAccountClients, resolveAccess } from "./access.js";
import type { AccountClient } from "./api.js";

const client = (patch: Partial<AccountClient>): AccountClient => ({
  clientId: "client_chatgpt",
  clientName: "ChatGPT",
  clientUri: null,
  mcpName: null,
  mcpVersion: null,
  authorizedAt: 1,
  lastUsedAt: null,
  allProjects: false,
  projects: [{ id: "pcl_1", projectId: "prj_1", revokedAt: null }],
  ...patch,
});

const chatgpt = client({});
const cursor = client({ clientId: "client_cursor", clientName: "Cursor" });
const everything = client({ clientId: "client_claude", allProjects: true, projects: [] });
const cutOff = client({
  clientId: "client_gone",
  projects: [{ id: "pcl_2", projectId: "prj_1", revokedAt: 5 }],
});

describe("connectedAccountClients", () => {
  it("keeps the clients that still reach something, or were given everything", () => {
    expect(
      connectedAccountClients([chatgpt, everything, cutOff]).map((entry) => entry.clientId),
    ).toEqual(["client_chatgpt", "client_claude"]);
  });
});

describe("chosenListClients", () => {
  it("asks only about the clients that were given a list", () => {
    expect(
      chosenListClients([chatgpt, cursor, everything, cutOff]).map((entry) => entry.clientId),
    ).toEqual(["client_chatgpt", "client_cursor"]);
  });
});

describe("resolveAccess", () => {
  it("ticks every client that has to be asked about", () => {
    expect(resolveAccess([chatgpt, cursor, everything], {})).toEqual([
      "client_chatgpt",
      "client_cursor",
    ]);
  });

  it("has nothing to tick before the clients have arrived, and ticks them when they do", () => {
    const byHand = {};
    expect(resolveAccess([], byHand)).toEqual([]);
    expect(resolveAccess([chatgpt, cursor], byHand)).toEqual(["client_chatgpt", "client_cursor"]);
  });

  it("keeps what the person changed when the list arrives again", () => {
    const byHand = { client_cursor: false };
    expect(resolveAccess([chatgpt, cursor], byHand)).toEqual(["client_chatgpt"]);
    // A refetch brings the same clients and one more. The box that was
    // unticked stays unticked, and the new one arrives ticked.
    const late = client({ clientId: "client_late", clientName: "Late" });
    expect(resolveAccess([chatgpt, cursor, late], byHand)).toEqual([
      "client_chatgpt",
      "client_late",
    ]);
  });

  it("lets a box be ticked again after it was unticked", () => {
    expect(resolveAccess([chatgpt], { client_chatgpt: true })).toEqual(["client_chatgpt"]);
  });

  it("never names a client that was given everything, which gets the project regardless", () => {
    expect(resolveAccess([everything], { client_claude: true })).toEqual([]);
  });
});
