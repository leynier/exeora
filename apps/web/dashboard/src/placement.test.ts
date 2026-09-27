import { describe, expect, it } from "vitest";
import { ApiError, type Project, type ProjectLocation, type User } from "./api.js";
import type { Machine } from "./api-projects.js";
import {
  cloudBlocker,
  instanceRefusal,
  locationCandidates,
  noPlacement,
  placement,
} from "./placement.js";

const user = (patch: { cloudEnabled?: boolean; used?: number; max?: number | null } = {}) =>
  ({
    cloudEnabled: patch.cloudEnabled ?? true,
    limits: { maxCloudMachines: patch.max === undefined ? 10 : patch.max },
    usage: { cloudMachines: patch.used ?? 3 },
  }) as unknown as User;

const location = (patch: Partial<ProjectLocation>): ProjectLocation => ({
  id: "loc_laptop",
  kind: "local",
  deviceId: "dev_laptop",
  name: "laptop",
  slug: "laptop",
  localPath: "/work/widgets",
  status: "ready",
  error: null,
  errorCode: null,
  default: true,
  online: true,
  state: "online",
  createdAt: 1,
  ...patch,
});

const cloud = location({ id: "loc_cloud", kind: "cloud", name: "Exeora Cloud", default: false });

const machine = (patch: Record<string, unknown>) =>
  ({
    deviceId: "dev_laptop",
    kind: "local",
    name: "laptop",
    cliVersion: "0.18.0",
    state: "online",
    projects: [],
    ...patch,
  }) as unknown as Machine;

describe("placement", () => {
  it("is a working copy next to the project on a machine that has one", () => {
    const plan = placement(location({}), user());
    expect(plan.blocked).toBe(false);
    expect(plan.sentence).toBe("A working copy of its own on laptop, next to the project.");
    expect(plan.progress).toBe("Creating the workspace on laptop…");
  });

  it("says the repository is cloned first on a machine that has no copy", () => {
    const plan = placement(location({ status: "pending", state: "not cloned" }), user());
    expect(plan.blocked).toBe(false);
    expect(plan.sentence).toContain("cloned there first");
    expect(plan.progress).toBe("Cloning the repository on laptop…");
  });

  it("refuses a machine that is offline or was revoked, and says what to do", () => {
    expect(placement(location({ state: "offline" }), user())).toMatchObject({
      blocked: true,
      sentence: "laptop is offline. Run `exeora connect` on it, then try again.",
    });
    expect(placement(location({ state: "removed" }), user()).blocked).toBe(true);
  });

  it("counts an instance against the limit and refuses when it is reached", () => {
    expect(placement(cloud, user()).sentence).toContain("3 of 10 in use");
    expect(placement(cloud, user({ max: null })).sentence).toContain("3 in use");
    expect(placement(cloud, user({ used: 10 }))).toMatchObject({ blocked: true });
  });

  it("says the project is put on Cloud first when it is not there yet", () => {
    expect(placement(null, user()).sentence).toContain("put on Exeora Cloud first");
    expect(placement(cloud, user()).sentence).not.toContain("put on Exeora Cloud first");
  });
});

describe("noPlacement", () => {
  it("refuses a project with no location to choose, and says what to do first", () => {
    expect(noPlacement({ nowhere: true })).toEqual({
      sentence:
        "This project lives nowhere, so there is no place to make a workspace. Add a location first.",
      progress: "",
      blocked: true,
    });
    expect(noPlacement({ nowhere: false })).toMatchObject({
      blocked: true,
      sentence: "This project has no location that can take a workspace. Add a location first.",
    });
  });
});

describe("instanceRefusal", () => {
  it("says there is no room, and where room is made, when the plan is full", () => {
    expect(instanceRefusal(new ApiError(403, { error: "plan_limit", max: 2 }), "fallback")).toBe(
      "Exeora Cloud has no room for another instance: all 2 of the plan are in use. Destroy one under Machines to make room.",
    );
    expect(instanceRefusal(new ApiError(403, { error: "plan_limit" }), "fallback")).toBe(
      "Exeora Cloud has no room for another instance. Destroy one under Machines to make room.",
    );
  });

  it("says who enables Exeora Cloud for an account that has it switched off", () => {
    expect(instanceRefusal(new ApiError(403, { error: "cloud_disabled" }), "fallback")).toBe(
      "Exeora Cloud is not enabled for this account. An administrator enables it.",
    );
  });

  it("keeps the gateway's own sentence for any other refusal", () => {
    const refusal = new ApiError(409, { error: "no_machine", message: "Nothing to start." });
    expect(instanceRefusal(refusal, "fallback")).toBe("Nothing to start.");
    expect(instanceRefusal("not an error", "The instance could not be started.")).toBe(
      "The instance could not be started.",
    );
  });
});

describe("cloudBlocker", () => {
  it("is nothing for an account that has Cloud and room in it", () => {
    expect(cloudBlocker(user())).toBeNull();
    expect(cloudBlocker(user({ max: null, used: 50 }))).toBeNull();
  });

  it("says who enables Cloud, and what to do at the limit", () => {
    expect(cloudBlocker(user({ cloudEnabled: false }))).toContain("An administrator enables it");
    expect(cloudBlocker(user({ used: 10 }))).toContain("10 of 10");
    expect(cloudBlocker(undefined)).not.toBeNull();
  });
});

describe("locationCandidates", () => {
  const project = { locations: [location({})] } as Pick<Project, "locations">;
  const machines = [
    machine({}),
    machine({ deviceId: "dev_desktop", name: "desktop" }),
    machine({ deviceId: "dev_old", name: "old", cliVersion: "0.17.9" }),
    machine({ deviceId: "dev_gone", name: "gone", state: "removed" }),
    machine({ deviceId: "dev_instance", kind: "cloud", name: "widgets-main" }),
  ];

  it("offers the machines the project is not on, and Exeora Cloud", () => {
    const candidates = locationCandidates(project, machines, user());
    expect(candidates.map((candidate) => candidate.name)).toEqual([
      "desktop",
      "old",
      "Exeora Cloud",
    ]);
    expect(candidates[0]?.blocked).toBeNull();
    expect(candidates[2]?.blocked).toBeNull();
  });

  it("lists a machine whose CLI cannot clone, with what to do about it", () => {
    const old = locationCandidates(project, machines, user())[1];
    expect(old?.blocked).toContain("Update the CLI on this machine.");
    expect(old?.blocked).toContain("0.17.9");
  });

  it("leaves Cloud out for a project that is there, and closes it without access", () => {
    const there = { locations: [location({}), cloud] };
    expect(locationCandidates(there, machines, user()).map((candidate) => candidate.name)).toEqual([
      "desktop",
      "old",
    ]);
    expect(locationCandidates(project, [], user({ cloudEnabled: false }))[0]?.blocked).toContain(
      "not enabled",
    );
  });
});
