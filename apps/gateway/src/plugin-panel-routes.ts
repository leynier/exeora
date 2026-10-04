export function trustedPanelOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.origin === value &&
      url.protocol === "https:" &&
      !url.port &&
      (url.hostname.endsWith(".web-sandbox.oaiusercontent.com") ||
        url.hostname.endsWith(".web-sandbox.chatgpt.com"))
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export function allowedPanelRoute(path: string, method: string): boolean {
  if (
    method === "GET" &&
    ["/api/me", "/api/projects", "/api/machines", "/api/terminals"].includes(path)
  )
    return true;
  if (method === "GET")
    return /^\/api\/projects\/[^/]+\/(?:workspaces|workspace\/(?:capabilities|status|diff))$/.test(
      path,
    );
  if (method === "POST")
    return /^\/api\/projects\/[^/]+\/(?:workspace\/(?:reads|actions)|terminal-ticket|logs-ticket)$/.test(
      path,
    );
  return method === "DELETE" && /^\/api\/projects\/[^/]+\/terminal$/.test(path);
}
