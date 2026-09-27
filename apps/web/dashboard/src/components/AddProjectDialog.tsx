import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { chosenListClients, resolveAccess } from "../access.js";
import { errorText } from "../api.js";
import { type CreateProjectInput, type GitHubRepository, projectsApi } from "../api-projects.js";
import { cloudBlocker } from "../placement.js";
import { isHttpsUrl, nameFromRepoUrl, slugFromName } from "../projectModel.js";
import { keys, refreshPlaces, useAccountClients, useGitHub, useMe } from "../queries.js";
import { AddProjectWhere, type ProjectPlace } from "./AddProjectWhere.js";
import { Advanced, Dialog, DialogActions, DialogError, DialogProgress, Field } from "./Dialog.js";
import { ConnectGitHubButton } from "./GitHubConnect.js";
import { ProjectAccessPicker } from "./ProjectAccessPicker.js";
import { RepositoryPicker } from "./RepositoryPicker.js";
import { useToast } from "./toast.js";

type Step = "what" | "where" | "access";

const STEP_NAMES: Record<Step, string> = {
  what: "Which repository",
  where: "Where it lives",
  access: "Which clients reach it",
};

/**
 * Adding a project, in the order the questions come up: which repository,
 * where it lives first, and which clients reach it.
 *
 * With GitHub connected the first answer is picking from a list, and no
 * address or token is ever typed. Any other git server is still one address
 * away, under the list. The branch is not asked for: the gateway reads it
 * from the repository, and a field that defaults to `main` is wrong for every
 * repository whose branch is `master`.
 */
export function AddProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  const create = useMutation({
    mutationFn: projectsApi.createProject,
    onSuccess: (result, input) => {
      toast(
        result.location === "joined"
          ? `${input.name} was already a project. It is on Exeora Cloud now, as one more location.`
          : `Setting up ${input.name} on Exeora Cloud.`,
      );
      void refreshPlaces(queryClient, result.projectId);
      // The project may have been given to clients on the way.
      void queryClient.invalidateQueries({ queryKey: keys.accountClients });
      void queryClient.invalidateQueries({ queryKey: keys.clients });
      void queryClient.invalidateQueries({ queryKey: keys.github });
      create.reset();
      onClose();
      navigate(`/projects/${result.projectId}`);
    },
  });

  const close = () => {
    if (create.isPending) return;
    create.reset();
    onClose();
  };

  return (
    <Dialog open={open} title="Add a project" wide onCancel={close}>
      <Form
        pending={create.isPending}
        error={create.isError ? errorText(create.error, "The project could not be added.") : null}
        onClearError={() => create.reset()}
        onClose={close}
        onSubmit={(input) => create.mutate(input)}
      />
    </Dialog>
  );
}

function Form({
  pending,
  error,
  onClearError,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  error: string | null;
  onClearError: () => void;
  onClose: () => void;
  onSubmit: (input: CreateProjectInput) => void;
}) {
  const me = useMe();
  const github = useGitHub();
  const accountClients = useAccountClients();

  const [step, setStep] = useState<Step>("what");
  const [repository, setRepository] = useState<GitHubRepository | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const [place, setPlace] = useState<ProjectPlace | null>(null);
  const [byHand, setByHand] = useState<Record<string, boolean>>({});
  const [withoutClients, setWithoutClients] = useState(false);

  const connected = github.data?.enabled === true && github.data.connected;
  const offerConnect = github.data?.enabled === true && !github.data.connected;

  // The name and the slug follow from the repository until somebody types
  // over them, so the common case is picking one and pressing the button.
  const derivedName = repository ? repository.name : nameFromRepoUrl(repoUrl);
  const effectiveName = (name ?? derivedName).trim();
  const effectiveSlug = slugFromName(slug ?? effectiveName);
  const address = repository ? repository.url : repoUrl.trim();
  const known = repository !== null || isHttpsUrl(address);
  const whatReady = known && effectiveName.length > 0 && effectiveSlug.length > 0;

  const blocker = cloudBlocker(me.data);
  const chosenPlace: ProjectPlace = place ?? (blocker ? "machine" : "cloud");
  const clients = accountClients.data ?? [];
  // A request that failed is not an account with nobody to ask. Read as one,
  // the project would be created with no client named, and every client that
  // chose its projects would be left without it with nothing to say so.
  const clientsFailed = accountClients.isError && accountClients.data === undefined;
  const asks = chosenListClients(clients).length > 0 || clientsFailed;
  // The step somebody is on stays a step, whatever a late answer says.
  const steps: Step[] =
    (asks || step === "access") && chosenPlace === "cloud"
      ? ["what", "where", "access"]
      : ["what", "where"];
  const last = step === steps.at(-1);
  // Until the clients have arrived nobody can say whether there is a third
  // step, nor which of them would be left without the project.
  const clientsPending = accountClients.isLoading;
  const unanswered = last && clientsFailed && !withoutClients;

  const submit = () => {
    const access = clientsFailed ? [] : resolveAccess(clients, byHand);
    onSubmit({
      name: effectiveName,
      slug: effectiveSlug,
      repoUrl: address,
      ...(branch.trim() ? { defaultBranch: branch.trim() } : {}),
      ...(repository
        ? { github: { repositoryId: repository.id, installationId: repository.installationId } }
        : {
            ...(token ? { token } : {}),
            ...(token && username.trim() ? { username: username.trim() } : {}),
          }),
      ...(access.length > 0 ? { clientIds: access } : {}),
    });
  };

  const forward = () => {
    onClearError();
    if (step === "what") setStep("where");
    else if (chosenPlace === "machine") onClose();
    else if (!last) setStep("access");
    else submit();
  };

  const back = () => {
    onClearError();
    setStep(step === "access" ? "where" : "what");
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending) forward();
      }}
    >
      <p className="text-label-md text-foreground-faint mt-2 font-mono uppercase">
        Step {steps.indexOf(step) + 1} of {steps.length} · {STEP_NAMES[step]}
      </p>

      {step === "what" ? (
        <>
          {connected ? (
            <RepositoryPicker
              selected={repository}
              disabled={pending}
              onSelect={(picked) => {
                setRepository(picked);
                setRepoUrl("");
              }}
              onNavigate={onClose}
            />
          ) : null}

          {offerConnect ? (
            <div className="border-border mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
              <p className="text-body-md text-foreground-muted min-w-0 flex-1">
                Connect GitHub to pick a repository from a list, with no address and no token to
                paste.
              </p>
              <ConnectGitHubButton className="btn shrink-0" />
            </div>
          ) : null}

          <details className="mt-4" open={!connected}>
            <summary className="text-body-md text-foreground-muted hover:text-foreground">
              {/* "Another" only means something beside a list of GitHub's. */}
              {connected || offerConnect ? "Another Git server" : "By its address"}
            </summary>
            <Field
              label="Repository URL"
              type="url"
              value={repoUrl}
              onChange={(value) => {
                setRepoUrl(value);
                if (value) setRepository(null);
              }}
              disabled={pending}
              placeholder="https://git.example.com/you/repo.git"
            />
            <Field
              label="Access token"
              type="password"
              value={token}
              onChange={setToken}
              disabled={pending}
              placeholder="Optional, for a private repository"
            />
            <Field
              label="Token username"
              value={username}
              onChange={setUsername}
              disabled={pending || token.length === 0}
              placeholder="x-access-token"
            />
            <p className="text-body-md text-foreground-faint mt-2">
              A token needs read access to clone and write access to push. It is stored encrypted,
              used only by the instances of this project, and deleted with it.
            </p>
          </details>

          {known ? (
            <p className="text-body-md text-foreground-muted mt-4">
              Adding <span className="font-mono">{repository?.fullName ?? address}</span> as{" "}
              <span className="text-foreground">{effectiveName || "…"}</span>
              <span className="text-foreground-faint font-mono">
                {" "}
                · slug: {effectiveSlug || "…"}
              </span>
            </p>
          ) : null}

          <Advanced>
            <Field
              label="Name"
              value={name ?? derivedName}
              onChange={setName}
              disabled={pending}
              placeholder="repo"
            />
            <Field
              label="Slug"
              value={slug ?? effectiveSlug}
              onChange={setSlug}
              disabled={pending}
              placeholder="repo"
              hint="Lowercase letters, digits and hyphens."
            />
            <Field
              label="Default branch"
              value={branch}
              onChange={setBranch}
              disabled={pending}
              placeholder={repository?.defaultBranch ?? "Detected from the repository"}
              hint="Leave it empty and the gateway reads it from the repository."
            />
          </Advanced>
        </>
      ) : null}

      {step === "where" ? (
        <AddProjectWhere
          place={chosenPlace}
          user={me.data}
          repository={repository?.fullName ?? address}
          disabled={pending}
          onChange={setPlace}
        />
      ) : null}

      {step === "access" && clientsFailed ? (
        <ClientsUnavailable
          error={errorText(accountClients.error, "The gateway did not answer.")}
          retrying={accountClients.isFetching}
          withoutClients={withoutClients}
          disabled={pending}
          onRetry={() => void accountClients.refetch()}
          onWithoutClients={setWithoutClients}
        />
      ) : null}

      {step === "access" && !clientsFailed ? (
        <>
          <p className="text-body-md text-foreground-muted mt-4">
            {chosenListClients(clients).length > 0
              ? "These clients are connected through the account URL with a list of projects you chose. Untick one to leave this project out of its list."
              : "No client on the account URL has a list of projects to add this one to, so there is nobody to ask."}
          </p>
          <ProjectAccessPicker
            clients={clients}
            chosen={resolveAccess(clients, byHand)}
            disabled={pending}
            onToggle={(clientId, ticked) =>
              setByHand((current) => ({ ...current, [clientId]: ticked }))
            }
          />
        </>
      ) : null}

      {pending ? (
        <DialogProgress>
          Reading the repository and asking Exeora Cloud for an instance…
        </DialogProgress>
      ) : null}
      <DialogError>{error}</DialogError>

      <DialogActions>
        <button type="button" className="btn" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        {step !== "what" ? (
          <button type="button" className="btn" onClick={back} disabled={pending}>
            Back
          </button>
        ) : null}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={
            pending ||
            !whatReady ||
            (step !== "what" &&
              chosenPlace === "cloud" &&
              (clientsPending || unanswered || blocker !== null))
          }
        >
          {pending
            ? "Working…"
            : step === "what"
              ? "Continue"
              : chosenPlace === "machine"
                ? "Done"
                : clientsPending
                  ? "Loading clients…"
                  : last
                    ? "Add project"
                    : "Continue"}
        </button>
      </DialogActions>
    </form>
  );
}

/**
 * What the access step says when the clients could not be read.
 *
 * Two ways on and no third. Trying again is the one most people want. Going
 * ahead without the clients is allowed, because a gateway that is having a
 * bad minute should not stop a project from being added, and it is a box to
 * tick rather than the default, because what it costs is silent: a client
 * that chose its projects does not get this one until somebody gives it.
 */
function ClientsUnavailable({
  error,
  retrying,
  withoutClients,
  disabled,
  onRetry,
  onWithoutClients,
}: {
  error: string;
  retrying: boolean;
  withoutClients: boolean;
  disabled: boolean;
  onRetry: () => void;
  onWithoutClients: (value: boolean) => void;
}) {
  return (
    <>
      <div
        role="alert"
        className="border-error/30 bg-error/8 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
      >
        <div className="min-w-0 flex-1">
          <p className="text-body-md text-error">
            The clients connected through the account URL could not be loaded.
          </p>
          <p className="text-body-md text-foreground-muted mt-0.5">
            {error} Until they are, nobody can say which of them should be given this project.
          </p>
        </div>
        <button
          type="button"
          className="btn shrink-0"
          disabled={disabled || retrying}
          onClick={onRetry}
        >
          {retrying ? "Trying…" : "Try again"}
        </button>
      </div>
      <label className="text-body-md mt-4 flex items-start gap-2">
        <input
          type="checkbox"
          className="accent-foreground mt-1"
          checked={withoutClients}
          disabled={disabled}
          onChange={(event) => onWithoutClients(event.target.checked)}
        />
        <span>
          Add the project without giving it to any client
          <span className="text-foreground-muted block">
            A client that was given every project still gets it. Any other is given it afterwards,
            from Clients.
          </span>
        </span>
      </label>
    </>
  );
}
