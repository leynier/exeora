import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type Device, isOnline, relativeTime, Unauthorized } from "./api.js";
import { beginSignIn, completeSignIn, signOut, storedToken } from "./auth.js";

/**
 * The dashboard: which machines are connected, which projects they serve, and
 * what agents have been doing. Deliberately small: the CLI is where projects
 * are added, because only the machine knows its own paths.
 */
export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (window.location.pathname.endsWith("/callback")) {
        try {
          const returnTo = await completeSignIn(window.location.search);
          window.history.replaceState({}, "", returnTo);
          setReady(true);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Sign-in failed.");
        }
        return;
      }

      if (storedToken()) return setReady(true);
      await beginSignIn();
    })().catch((cause) => setError(cause instanceof Error ? cause.message : "Something failed."));
  }, []);

  if (error) return <Centered>{error}</Centered>;
  if (!ready) return <Centered>Signing in…</Centered>;
  return <Dashboard />;
}

function Dashboard() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });

  // Presence goes stale on its own, so devices are polled rather than waiting
  // for the user to reload.
  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: api.devices,
    refetchInterval: 15_000,
  });
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const calls = useQuery({ queryKey: ["calls"], queryFn: api.toolCalls, refetchInterval: 15_000 });

  if ([me, devices, projects, calls].some((query) => query.error instanceof Unauthorized)) {
    signOut();
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <a href="/" className="font-semibold tracking-tight">
            Exeora
          </a>
          <p className="text-sm text-neutral-500">{me.data?.email ?? "…"}</p>
        </div>
        <button type="button" onClick={signOut} className="btn">
          Sign out
        </button>
      </header>

      <Devices devices={devices.data ?? []} loading={devices.isLoading} />
      <Projects projects={projects.data ?? []} devices={devices.data ?? []} />
      <Activity calls={calls.data ?? []} />
    </div>
  );
}

function Devices({ devices, loading }: { devices: Device[]; loading: boolean }) {
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: api.revokeDevice,
    onSuccess: () => queryClient.invalidateQueries(),
  });

  return (
    <Section title="Machines">
      {loading && <Empty>Loading…</Empty>}
      {!loading && devices.length === 0 && (
        <Empty>
          No machines yet. Install the CLI and run <code>exeora device register</code>.
        </Empty>
      )}

      {devices.map((device) => (
        <Row key={device.id}>
          <div className="flex items-center gap-3">
            <Dot on={isOnline(device)} />
            <div>
              <p className="font-medium">{device.name}</p>
              <p className="text-sm text-neutral-500">
                {device.platform}
                {device.cliVersion ? ` · CLI ${device.cliVersion}` : ""} ·{" "}
                {device.revokedAt
                  ? "revoked"
                  : isOnline(device)
                    ? "online"
                    : `last seen ${relativeTime(device.lastSeenAt)}`}
              </p>
            </div>
          </div>

          {!device.revokedAt && (
            <button
              type="button"
              className="btn"
              disabled={revoke.isPending}
              onClick={() => {
                // Revoking cuts a live socket and stops that machine serving
                // anything, so it is worth one confirmation.
                if (confirm(`Revoke ${device.name}? It will stop serving tool calls at once.`)) {
                  revoke.mutate(device.id);
                }
              }}
            >
              Revoke
            </button>
          )}
        </Row>
      ))}
    </Section>
  );
}

function Projects({
  projects,
  devices,
}: {
  projects: Array<import("./api.js").Project>;
  devices: Device[];
}) {
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <Section title="Projects">
      {projects.length === 0 && (
        <Empty>
          No projects yet. On a registered machine, run <code>exeora project add .</code>
        </Empty>
      )}

      {projects.map((project) => {
        const device = devices.find((candidate) => candidate.id === project.deviceId);
        return (
          <Row key={project.id}>
            <div className="min-w-0">
              <p className="font-medium">{project.name}</p>
              <p className="truncate text-sm text-neutral-500">
                {device?.name ?? "unknown machine"} · {project.localPath}
              </p>
              <code className="mt-1 block truncate text-xs text-neutral-400">{project.mcpUrl}</code>
            </div>
            <button
              type="button"
              className="btn shrink-0"
              onClick={async () => {
                await navigator.clipboard.writeText(project.mcpUrl);
                setCopied(project.id);
                setTimeout(() => setCopied(null), 1500);
              }}
            >
              {copied === project.id ? "Copied" : "Copy MCP URL"}
            </button>
          </Row>
        );
      })}
    </Section>
  );
}

function Activity({ calls }: { calls: Array<import("./api.js").ToolCall> }) {
  return (
    <Section title="Recent tool calls">
      {calls.length === 0 && <Empty>Nothing yet.</Empty>}
      {calls.map((call) => (
        <Row key={call.id}>
          <div className="flex items-center gap-3">
            <span className={call.status === "ok" ? "text-emerald-600" : "text-red-600"}>
              {call.status === "ok" ? "✓" : "✗"}
            </span>
            <div>
              <code className="text-sm">{call.tool}</code>
              {call.errorCode && (
                <span className="ml-2 text-sm text-red-600">{call.errorCode}</span>
              )}
            </div>
          </div>
          <p className="text-sm text-neutral-500">
            {call.durationMs}ms · {relativeTime(call.createdAt)}
          </p>
        </Row>
      ))}
    </Section>
  );
}

// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-neutral-500 uppercase">
        {title}
      </h2>
      <div className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {children}
      </div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 px-4 py-3">{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-sm text-neutral-500">{children}</p>;
}

function Dot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`size-2 shrink-0 rounded-full ${on ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"}`}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-6 text-center text-neutral-600 dark:text-neutral-400">
      {children}
    </div>
  );
}
