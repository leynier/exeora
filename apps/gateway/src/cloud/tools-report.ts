import { z } from "zod";

/**
 * What a machine came with and what was added to it, as it is kept and shown.
 *
 * Written once by the tools step and read by every page that lists machines,
 * so it is checked on the way out: a row written by a gateway that described
 * it differently is shown as nothing rather than as something half right.
 */

export const ToolsReport = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      state: z.enum(["present", "installed", "failed", "skipped"]),
      version: z.string().nullable(),
      /** Whether the machine is handed over without it. Only `gh` is. */
      required: z.boolean(),
      reason: z.string().nullable(),
    }),
  ),
  environment: z.object({
    os: z.string().nullable(),
    arch: z.string().nullable(),
    sudo: z.boolean(),
    apt: z.boolean(),
    /** Whether `/dev/shm` is memory, which is where the token for `gh` is kept. */
    memoryDisk: z.boolean(),
  }),
});

export type ToolsReport = z.infer<typeof ToolsReport>;

export function toolsReportOf(stored: string | null): ToolsReport | null {
  if (!stored) return null;
  try {
    const parsed = ToolsReport.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
