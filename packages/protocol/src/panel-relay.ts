/** Plugin UI relay only: not part of the native executor's wire protocol. */
import { z } from "zod";

export const PANEL_RELAY_PROTOCOL = 1;
export const PanelId = z.uuid();
export const RelayTab = z.enum(["explorer", "search", "source", "pr", "terminal", "logs"]);
const path = z.string().min(1).max(4096);
export const RelaySearch = z
  .object({
    query: z.string().max(1000),
    regex: z.boolean(),
    caseSensitive: z.boolean(),
    wholeWord: z.boolean(),
    include: z.string().max(1000),
    exclude: z.string().max(1000),
    includeIgnored: z.boolean(),
  })
  .strict();
export const RelayNavigation = z
  .object({
    project: z.string().min(1).max(128).optional(),
    workspace: z.string().min(1).max(128).optional(),
    tab: RelayTab.optional(),
    path: path.optional(),
    diff: z
      .object({ path, area: z.enum(["working", "staged"]).optional() })
      .strict()
      .optional(),
    search: RelaySearch.partial().optional(),
  })
  .strict();
export type RelayNavigateArgs = z.infer<typeof RelayNavigation>;
export const RelayState = z
  .object({
    projectId: z.string().max(128).nullable(),
    workspace: z.string().max(128).nullable(),
    tab: RelayTab.nullable(),
    path: path.nullable(),
    diff: z
      .object({ path, area: z.enum(["working", "staged"]) })
      .strict()
      .nullable(),
    openPaths: z.array(path).max(1000),
    dirtyPaths: z.array(path).max(1000),
    search: RelaySearch.nullable(),
    pendingConfirmation: z
      .object({
        projectId: z.string().max(128).nullable(),
        workspace: z.string().max(128).nullable(),
        dirtyPaths: z.array(path).max(1000),
      })
      .strict()
      .nullable(),
    lastConfirmation: z.enum(["applied", "cancelled"]).nullable(),
  })
  .strict();
export const RelayResult = z
  .object({
    status: z
      .enum(["applied", "queued", "needs_confirmation", "cancelled", "error", "superseded"])
      .optional(),
    message: z.string().max(2000).optional(),
    state: RelayState,
  })
  .strict();
export type PanelRelayResult = z.infer<typeof RelayResult>;
export const RelayCommand = z
  .object({
    type: z.literal("command"),
    protocol: z.literal(1),
    panelId: PanelId,
    requestId: z.uuid(),
    generation: z.uuid(),
    operation: z.enum(["get_state", "navigate"]),
    args: RelayNavigation,
    deadline: z.number().int().positive(),
  })
  .strict();
export type PanelRelayCommand = z.infer<typeof RelayCommand>;
export const RelayReady = z
  .object({
    type: z.literal("ready"),
    protocol: z.literal(1),
    panelId: PanelId,
    generation: z.uuid(),
  })
  .strict();
export const RelayCancel = z
  .object({
    type: z.literal("cancel"),
    protocol: z.literal(1),
    requestId: z.uuid(),
    generation: z.uuid(),
  })
  .strict();
export const RelayResponse = z
  .object({
    type: z.literal("result"),
    protocol: z.literal(1),
    requestId: z.uuid(),
    generation: z.uuid(),
    result: RelayResult,
  })
  .strict();
export const RelayTicketRequest = z
  .object({
    panelId: PanelId.optional(),
    origin: z.string().max(512),
    surface: z.enum(["workspace", "dashboard"]).default("workspace"),
  })
  .strict();
export interface PanelRelayTicket {
  panelId: string;
  protocol: 1;
  url: string;
  expiresAt: number;
  /** Dashboard tickets must first be exchanged with its independent bearer. */
  pairingTicket?: string;
}
