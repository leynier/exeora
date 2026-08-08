import * as p from "@clack/prompts";
import type { Command } from "commander";
import { gateway } from "../api.js";
import { login } from "../auth/login.js";
import { clearCredentials, usingFileFallback } from "../auth/store.js";
import { cacheAccessToken, forgetAccessToken } from "../auth/tokens.js";
import { configPath, gatewayUrl } from "../config.js";
import { useGateway } from "../gateway.js";
import { guard } from "../output.js";

/** Signing in and out. Both are about the session and nothing else. */
export function register(program: Command): void {
  program
    .command("login")
    .description("Sign in to Exeora in your browser")
    .option("-g, --gateway <url>", "Sign in to this Exeora instead, and remember it")
    .option("-y, --yes", "Do not ask before switching gateway")
    .action(
      guard(async (options: { gateway?: string; yes?: boolean }) => {
        p.intro("Exeora");
        if (!(await useGateway(options))) return;

        const spinner = p.spinner();
        spinner.start("Waiting for the browser…");

        const result = await login();
        cacheAccessToken(result.accessToken, result.expiresAt);
        const user = await gateway.me();

        spinner.stop(`Signed in as ${user.email}`);
        if (usingFileFallback()) {
          p.log.warn(
            `No system keychain available, so the session is stored in a 0600 file under ${configPath().replace(/config\.json$/, "")}.`,
          );
        }
        p.outro("Run `exeora connect` in a project directory.");
      }),
    );

  program
    .command("logout")
    .description("Forget the stored session on this machine")
    .action(
      guard(async () => {
        await clearCredentials();
        forgetAccessToken();
        p.log.success(
          `Signed out of ${gatewayUrl()}. The device is still registered; revoke it in the dashboard.`,
        );
      }),
    );
}
