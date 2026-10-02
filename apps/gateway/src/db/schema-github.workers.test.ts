import { env } from "cloudflare:test";
import { expect, it } from "vitest";

it("looks up repositories for installation reconciliation without scanning every account", async () => {
  const plan = async (phase: "indexed" | "previous") => {
    const result = await env.DB.prepare(
      `EXPLAIN QUERY PLAN SELECT project_id, repo_id FROM github_repositories WHERE installation_id = ? AND lost_access_at IS NULL /* ${phase} */`,
    )
      .bind(123)
      .all<{ detail: string }>();
    return result.results.map((row) => row.detail).join("\n");
  };

  expect(await plan("indexed")).toContain(
    "SEARCH github_repositories USING INDEX github_repositories_installation",
  );
  // Compare the previous access path in this test's isolated D1 database.
  await env.DB.exec("DROP INDEX github_repositories_installation");
  try {
    expect(await plan("previous")).toContain("SCAN github_repositories");
  } finally {
    await env.DB.exec(
      "CREATE INDEX github_repositories_installation ON github_repositories (installation_id)",
    );
  }
});
