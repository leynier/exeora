import { createAuth } from "./auth.js";

/** The gateway this build talks to, fixed by `wxt.config.ts`. */
export const GATEWAY = import.meta.env.EXEORA_GATEWAY_URL;

export const auth = createAuth({
  gateway: GATEWAY,
  fetch: (input, init) => fetch(input, init),
  local: browser.storage.local,
  session: browser.storage.session,
  identity: {
    getRedirectURL: () => browser.identity.getRedirectURL(),
    launchWebAuthFlow: (options) => browser.identity.launchWebAuthFlow(options),
  },
  now: () => Date.now(),
});

export function openTab(url: string): void {
  void browser.tabs.create({ url });
}
