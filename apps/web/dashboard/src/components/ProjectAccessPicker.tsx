import type { AccountClient } from "../api.js";
import { clientLabel } from "../format.js";

/** The clients still connected through the account URL: the only ones a project can be given to. */
export function connectedAccountClients(clients: AccountClient[]): AccountClient[] {
  return clients.filter(
    (client) => client.allProjects || client.projects.some((entry) => entry.revokedAt === null),
  );
}

/** What arrives ticked: every client that has to be told, since the others get it regardless. */
export function defaultAccess(clients: AccountClient[]): string[] {
  return connectedAccountClients(clients)
    .filter((client) => !client.allProjects)
    .map((client) => client.clientId);
}

/**
 * Which AI clients reach a project that is about to exist.
 *
 * Asked while creating it, because the other place to answer is a different
 * page, after the fact, once a client has already said it cannot see the
 * project. A client that was given every project is listed and not asked about:
 * it gets this one too, and showing it says so.
 */
export function ProjectAccessPicker({
  clients,
  chosen,
  disabled,
  onChange,
}: {
  clients: AccountClient[];
  chosen: string[];
  disabled: boolean;
  onChange: (clientIds: string[]) => void;
}) {
  const connected = connectedAccountClients(clients);
  if (connected.length === 0) return null;

  return (
    <fieldset className="border-border mt-4 rounded-lg border p-1" disabled={disabled}>
      <legend className="text-label-md text-foreground-faint px-2">Clients that reach it</legend>
      {connected.map((client) => (
        <label
          key={client.clientId}
          className="hover:bg-accent-subtle flex cursor-pointer items-center gap-3 rounded-md px-3 py-2"
        >
          <input
            type="checkbox"
            className="accent-foreground"
            checked={client.allProjects || chosen.includes(client.clientId)}
            disabled={client.allProjects}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...chosen, client.clientId]
                  : chosen.filter((id) => id !== client.clientId),
              )
            }
          />
          <span className="text-body-md min-w-0 truncate">{clientLabel(client)}</span>
          {client.allProjects && (
            <span className="text-body-md text-foreground-faint ml-auto shrink-0">
              reaches every project
            </span>
          )}
        </label>
      ))}
    </fieldset>
  );
}
