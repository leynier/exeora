import { type ReactNode, useCallback, useRef, useState } from "react";
import type { ChatgptStatus } from "../../api-ai.js";
import { type ChatgptWelcome, ChatgptWelcomeDialog } from "./ChatgptWelcomeDialog.js";
import { chatgptAccountLabel } from "./chatgpt-state.js";
import { ChatgptWelcomeContext } from "./useChatgptWelcome.js";

/** One dialog survives navigation; explicit acknowledgement remains machine-bound. */
export function ChatgptWelcomeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState(new Map<string, ChatgptWelcome>());
  const [holds, setHolds] = useState(0);
  const dismissed = useRef(new Set<string>());
  const showWelcome = useCallback((deviceId: string, status: ChatgptStatus) => {
    const account = status.account;
    const noticeId =
      status.state === "ready" && account?.newRegistration && account.planUsage
        ? account.noticeId
        : undefined;
    const key = `${deviceId}:${noticeId}`;
    setNotices((current) => {
      const next = new Map(current);
      for (const [id, notice] of next) {
        if (notice.deviceId === deviceId && id !== key) next.delete(id);
      }
      if (noticeId && !dismissed.current.has(key) && !next.has(key)) {
        next.set(key, {
          deviceId,
          noticeId,
          accountLabel: chatgptAccountLabel(account) ?? "ChatGPT account",
        });
      }
      return next.size === current.size && [...next.keys()].every((id) => current.has(id))
        ? current
        : next;
    });
  }, []);
  const holdWelcome = useCallback(() => {
    setHolds((current) => current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setHolds((current) => current - 1);
    };
  }, []);
  const welcome = holds === 0 ? (notices.values().next().value ?? null) : null;
  const closeWelcome = () => {
    if (!welcome) return;
    const key = `${welcome.deviceId}:${welcome.noticeId}`;
    dismissed.current.add(key);
    setNotices((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  };
  return (
    <ChatgptWelcomeContext value={{ showWelcome, holdWelcome }}>
      {children}
      <ChatgptWelcomeDialog welcome={welcome} onDone={closeWelcome} />
    </ChatgptWelcomeContext>
  );
}
