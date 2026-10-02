import { createContext, useContext } from "react";
import type { ChatgptStatus } from "../../api-ai.js";

export const ChatgptWelcomeContext = createContext({
  showWelcome: (_deviceId: string, _status: ChatgptStatus) => {},
  holdWelcome: (): (() => void) => () => {},
});

/** All sources share the authenticated root's single welcome host. */
export function useChatgptWelcome() {
  return useContext(ChatgptWelcomeContext);
}
