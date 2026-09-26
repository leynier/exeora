/**
 * Account plans and the limits each one carries.
 *
 * There is no billing yet. The map still exists so device and project caps,
 * audit retention and the usage surface all have one place to look, and so
 * turning billing on later is a value change rather than a redesign.
 *
 * `null` on a numeric limit means unlimited. Retention is always a number of
 * days: an audit trail that never ends is a storage problem nobody has asked
 * for, and the maintenance job needs a cutoff.
 */

export const PLAN_IDS = ["free", "pro"] as const;

export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanLimits {
  /** Live (non-revoked) devices. Null means no cap. */
  maxDevices: number | null;
  /** Projects owned by the account. Null means no cap. */
  maxProjects: number | null;
  /**
   * Exeora Cloud machines the account may have at once. Finite on every plan,
   * because each one is a microVM someone pays for. Separate from the device
   * cap so a cloud machine never takes a slot from a laptop.
   */
  maxCloudMachines: number | null;
  /** How long an audit row remains visible, in rolling 24-hour days. */
  retentionDays: number;
}

export interface PlanDefinition extends PlanLimits {
  id: PlanId;
}

/**
 * Free keeps one day of detailed Activity; durable daily usage totals outlive
 * that window. Device and project caps remain unchanged.
 */
export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    maxDevices: 10,
    maxProjects: 25,
    maxCloudMachines: 2,
    retentionDays: 1,
  },
  pro: {
    id: "pro",
    maxDevices: null,
    maxProjects: null,
    maxCloudMachines: 10,
    retentionDays: 365,
  },
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

/** Resolve a plan id that arrived from the database or a default. */
export function limitsFor(plan: PlanId | string | null | undefined): PlanLimits {
  const id: PlanId = isPlanId(plan) ? plan : "free";
  const { maxDevices, maxProjects, maxCloudMachines, retentionDays } = PLANS[id];
  return { maxDevices, maxProjects, maxCloudMachines, retentionDays };
}

/** Every distinct retention window, for archive maintenance to walk. */
export function retentionTiers(): Array<{ plan: PlanId; retentionDays: number }> {
  return PLAN_IDS.map((plan) => ({ plan, retentionDays: PLANS[plan].retentionDays }));
}
