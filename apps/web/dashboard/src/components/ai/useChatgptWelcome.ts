import { useCallback, useRef, useState } from "react";
import type { ChatgptStatus } from "../../api-ai.js";
import type { ChatgptWelcome } from "./ChatgptWelcomeDialog.js";

/** Keep an unconfirmed notice on the machine while allowing dismissal in this UI session. */
export function useChatgptWelcome() {
  const [welcome, setWelcome] = useState<ChatgptWelcome | null>(null);
  const dismissed = useRef(new Set<string>());
  const showWelcome = useCallback((deviceId: string, status: ChatgptStatus) => {
    const account = status.account;
    if (!account?.newRegistration || !account.planUsage || !account.noticeId) return;
    const key = `${deviceId}:${account.noticeId}`;
    if (dismissed.current.has(key)) return;
    const noticeId = account.noticeId;
    setWelcome((current) => current ?? { deviceId, noticeId });
  }, []);
  const closeWelcome = () => {
    if (welcome) dismissed.current.add(`${welcome.deviceId}:${welcome.noticeId}`);
    setWelcome(null);
  };
  return { welcome, showWelcome, closeWelcome };
}
