import { DurableObject } from "cloudflare:workers";
import "./env.js";

/**
 * One instance per `userId:deviceId`. Holds the single outbound WebSocket the
 * Exeora CLI dials, and turns MCP tool calls into request/response over it.
 *
 * Implemented in M4. The class exists from M1 so the `new_sqlite_classes`
 * migration in wrangler.jsonc can be applied on the first deploy.
 */
export class DeviceRelay extends DurableObject<Env> {
  async isOnline(): Promise<boolean> {
    return this.ctx.getWebSockets().length > 0;
  }
}
