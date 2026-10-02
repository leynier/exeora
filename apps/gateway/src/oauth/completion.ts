import { and, eq } from "drizzle-orm";
import { type AccountChoice, rememberAccountAuthorization } from "../account-access.js";
import { rememberAuthorization } from "../clients.js";
import { db, schema } from "../db/client.js";
import { rememberExtensionConsent } from "./extension.js";
import { UpstreamAuthError } from "./providers/index.js";
import { grantedScopes } from "./scopes.js";
import { authScopeFromResource, refusedResource } from "./target.js";

type AuthRequest = Awaited<ReturnType<Env["OAUTH_PROVIDER"]["parseAuthRequest"]>>;

/** Mints the authorization code after the consent decision has been checked. */
export async function complete(
  env: Env,
  authRequest: AuthRequest,
  userId: string,
  account?: AccountChoice,
) {
  const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId).catch(() => null);
  const scope = authScopeFromResource(authRequest.resource);
  const scopes = await grantedScopes(env, authRequest);
  const refused = refusedResource(scopes, authRequest.resource);
  if (refused) throw new Error(refused);
  const identity = { clientName: client?.clientName, clientUri: client?.clientUri };
  const extension = await rememberExtensionConsent(env, authRequest, userId);

  const projectId =
    scope?.kind === "project" ? await ownedProjectId(env, scope.projectId, userId) : null;
  const projectIds = scope?.kind === "account" ? (account?.projectIds ?? []) : null;

  if (projectId) {
    await rememberAuthorization(env, {
      userId,
      projectId,
      clientId: authRequest.clientId,
      endpoint: "project",
      ...identity,
    });
  }

  if (projectIds) {
    await rememberAccountAuthorization(env, {
      userId,
      clientId: authRequest.clientId,
      projectIds,
      allProjects: account?.allProjects ?? false,
      ...identity,
    });
  }

  return env.OAUTH_PROVIDER.completeAuthorization({
    request: authRequest,
    userId,
    scope: scopes,
    ...(extension ? { revokeExistingGrants: false } : {}),
    metadata: {
      approvedAt: Date.now(),
      projectId,
      ...(projectIds ? { projectIds } : {}),
      ...(extension ? { extensionId: extension } : {}),
      clientName: client?.clientName ?? null,
    },
    props: {
      userId,
      clientId: authRequest.clientId,
      clientName: client?.clientName,
      scopes,
    },
  });
}

async function ownedProjectId(
  env: Pick<Env, "DB">,
  projectId: string,
  userId: string,
): Promise<string | null> {
  const project = await db(env)
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();

  return project?.id ?? null;
}

/** Uses the configured origin so the upstream callback cannot follow Host. */
export function callbackUri(env: Env, providerId: string): string {
  return new URL(`/oauth/callback/${providerId}`, env.EXEORA_BASE_URL).toString();
}

export function describe(error: unknown): string {
  if (error instanceof UpstreamAuthError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected error.";
}
