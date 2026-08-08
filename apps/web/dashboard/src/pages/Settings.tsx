import { DangerZone } from "../components/DangerZone.js";
import { SupportCard } from "../components/SupportCard.js";
import { Card, Divided, PageHeader, Row, SkeletonRows } from "../components/ui.js";
import { useMe } from "../queries.js";

/**
 * Account-level preferences and irreversible actions.
 *
 * Settings is the place for things that are about the signed-in person rather
 * than a machine, a project or a client. The danger section lives here so the
 * overview can stay about the state of the fleet, and so anything else that
 * cannot be undone has a single home.
 */
export function Settings() {
  const me = useMe();
  const user = me.data;

  return (
    <>
      <PageHeader title="Settings" subtitle="Account preferences and irreversible actions." />

      <Card title="Plan" className="mb-6">
        {me.isLoading || !user ? (
          <SkeletonRows count={3} />
        ) : (
          <Divided>
            <Row>
              <p className="text-body-md text-foreground-muted">Current plan</p>
              <p className="text-title-md capitalize">{user.plan}</p>
            </Row>
            <Row>
              <p className="text-body-md text-foreground-muted">Machines</p>
              <p className="text-title-md tabular-nums">
                {formatCap(user.usage.devices, user.limits.maxDevices)}
              </p>
            </Row>
            <Row>
              <p className="text-body-md text-foreground-muted">Projects</p>
              <p className="text-title-md tabular-nums">
                {formatCap(user.usage.projects, user.limits.maxProjects)}
              </p>
            </Row>
            <Row>
              <p className="text-body-md text-foreground-muted">Audit retention</p>
              <p className="text-title-md tabular-nums">{user.limits.retentionDays} days</p>
            </Row>
            <Row>
              <p className="text-body-md text-foreground-muted">Tool calls this month</p>
              <p className="text-title-md tabular-nums">
                {user.usage.toolCallsMonth.toLocaleString()}
              </p>
            </Row>
          </Divided>
        )}
      </Card>

      <SupportCard className="mb-6" />

      <DangerZone />
    </>
  );
}

function formatCap(used: number, max: number | null): string {
  return max === null ? `${used} / ∞` : `${used} / ${max}`;
}
