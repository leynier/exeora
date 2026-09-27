import { connectedAccountClients } from "../access.js";
import type { AccountClient } from "../api.js";
import { clientLabel } from "../format.js";

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
  onToggle,
}: {
  clients: AccountClient[];
  /** The ids that are ticked, from `resolveAccess`. */
  chosen: string[];
  disabled: boolean;
  /** One box changed by hand. */
  onToggle: (clientId: string, ticked: boolean) => void;
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
            onChange={(event) => onToggle(client.clientId, event.target.checked)}
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
