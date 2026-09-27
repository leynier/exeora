import type { AccountClient } from "./api.js";

/**
 * Which clients on the account URL are given a project that is being added.
 *
 * Kept apart from the picker that draws them, so the rule can be tested
 * without a DOM: it is the rule that decides whether a client can see a
 * project at all, and getting it wrong is silent.
 */

/** The clients still connected through the account URL: the only ones a project can be given to. */
export function connectedAccountClients(clients: AccountClient[]): AccountClient[] {
  return clients.filter(
    (client) => client.allProjects || client.projects.some((entry) => entry.revokedAt === null),
  );
}

/** The clients that have to be asked about: connected, and given a chosen list of projects. */
export function chosenListClients(clients: AccountClient[]): AccountClient[] {
  return connectedAccountClients(clients).filter((client) => !client.allProjects);
}

/**
 * Which clients are ticked: every one that has to be asked about, except where
 * the person said otherwise.
 *
 * Computed from the clients as they are now and not copied when the dialog
 * opens. The dialog can open before the list of clients has arrived, and a
 * copy taken then is empty: every client would stay unticked and be left
 * without the project, with nothing on screen to say so. What the person
 * changed by hand is kept apart, box by box, so a list that arrives or
 * refreshes late never puts back a tick somebody took away.
 */
export function resolveAccess(
  clients: AccountClient[],
  byHand: Readonly<Record<string, boolean>>,
): string[] {
  return chosenListClients(clients)
    .filter((client) => byHand[client.clientId] ?? true)
    .map((client) => client.clientId);
}
