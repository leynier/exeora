import { describe, expect, it } from "vitest";
import type { CloudInstance, LocalMachine } from "./api-projects.js";
import type { ProjectLocation } from "./api-types.js";
import {
  deletionImpact,
  isLeaving,
  livesOnlyOnCloud,
  removalBlocker,
  standingLocations,
} from "./survival.js";

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

const laptop = location({});
const desktop = location({
  id: "loc_desktop",
  deviceId: "dev_desktop",
  name: "desktop",
  slug: "desktop",
  default: false,
});
/** Exeora Cloud running an instance for the project root. */
const cloud = location({
  id: "loc_cloud",
  kind: "cloud",
  deviceId: "dev_cloud_root",
  name: "Exeora Cloud",
  slug: "cloud",
  localPath: null,
  default: false,
  online: false,
  state: "asleep",
});
/** Exeora Cloud holding workspaces and nothing for the project root. */
const cloudWithoutRoot = { ...cloud, deviceId: null };
const removed = (entry: ProjectLocation): ProjectLocation => ({
  ...entry,
  online: false,
  state: "removed",
});

const project = (locations: ProjectLocation[], id = "prj_widgets") => ({ id, locations });

const instance = (state: CloudInstance["state"]) =>
  ({
    deviceId: "dev_cloud_root",
    kind: "cloud",
    state,
    project: { id: "prj_widgets", slug: "widgets", name: "Widgets" },
    workspace: { id: null, slug: "main", branch: "master" },
  }) as unknown as CloudInstance;

describe("standingLocations", () => {
  it("leaves out the locations whose machine was removed", () => {
    expect(
      standingLocations(project([laptop, removed(desktop), cloud])).map((entry) => entry.name),
    ).toEqual(["laptop", "Exeora Cloud"]);
    expect(standingLocations(undefined)).toEqual([]);
  });
});

describe("livesOnlyOnCloud", () => {
  it("is true only when no machine of the person holds the project", () => {
    expect(livesOnlyOnCloud(project([cloud]))).toBe(true);
    expect(livesOnlyOnCloud(project([laptop, cloud]))).toBe(false);
    expect(livesOnlyOnCloud(project([]))).toBe(false);
  });

  it("does not count a machine that was removed as somewhere the project lives", () => {
    // The gateway deletes this project with its root instance, so the dialog
    // must not promise that it keeps its other locations.
    expect(livesOnlyOnCloud(project([removed(laptop), cloud]))).toBe(true);
    expect(livesOnlyOnCloud(project([removed(laptop), removed(desktop), cloud]))).toBe(true);
    expect(livesOnlyOnCloud(project([removed(laptop), desktop, cloud]))).toBe(false);
  });

  it("is false for a project that lives nowhere at all any more", () => {
    expect(livesOnlyOnCloud(project([removed(laptop)]))).toBe(false);
  });
});

describe("isLeaving", () => {
  it("calls a project leaving only when all it has is instances on their way out", () => {
    expect(isLeaving(project([cloud]), [instance("removing")])).toBe(true);
    expect(isLeaving(project([cloud]), [instance("asleep")])).toBe(false);
    expect(isLeaving(project([laptop, cloud]), [instance("removing")])).toBe(false);
    expect(isLeaving(project([cloud]), [])).toBe(false);
  });

  it("sees through a removed machine to the project that is leaving with its instances", () => {
    expect(isLeaving(project([removed(laptop), cloud]), [instance("removing")])).toBe(true);
  });
});

describe("removalBlocker", () => {
  it("refuses the only location and the default one, in the gateway's words", () => {
    expect(removalBlocker(project([laptop]), laptop)).toContain("Remove the project instead");
    expect(removalBlocker(project([laptop, cloud]), laptop)).toContain("another default");
    expect(removalBlocker(project([laptop, cloud]), cloud)).toBeNull();
  });

  it("refuses the last place a project still lives when the other is a removed machine", () => {
    const gone = removed({ ...desktop });
    expect(removalBlocker(project([laptop, gone]), laptop)).toContain("Remove the project instead");
    expect(removalBlocker(project([{ ...cloud, default: true }, gone]), cloud)).toContain(
      "Remove the project instead",
    );
  });

  it("lets the record of a removed machine be cleaned up", () => {
    expect(removalBlocker(project([laptop, removed(desktop)]), removed(desktop))).toBeNull();
  });
});

describe("deletionImpact", () => {
  const held = (projectId: string, name: string) => ({
    projectId,
    slug: name.toLowerCase(),
    name,
    localPath: `/work/${name.toLowerCase()}`,
    status: "ready" as const,
    error: null,
    default: true,
    workspaces: 0,
  });
  const machine: Pick<LocalMachine, "deviceId" | "projects"> = {
    deviceId: "dev_laptop",
    projects: [
      held("prj_widgets", "Widgets"),
      held("prj_rooted", "Rooted"),
      held("prj_solo", "Solo"),
      held("prj_half", "Half"),
    ],
  };
  const names = (list: Array<{ name: string }>) => list.map((entry) => entry.name);

  it("sorts what the machine holds into what goes, what stays and what moves", () => {
    const impact = deletionImpact(machine, [
      project([laptop, desktop]),
      // Cloud runs an instance for the root, so there is a machine to carry on from.
      project([laptop, cloud], "prj_rooted"),
      project([laptop], "prj_solo"),
      // Cloud holds workspaces only: the gateway has to start an instance.
      project([laptop, cloudWithoutRoot], "prj_half"),
    ]);

    expect(names(impact.surviving)).toEqual(["Widgets", "Rooted"]);
    expect(names(impact.deleted)).toEqual(["Solo"]);
    expect(names(impact.moving)).toEqual(["Half"]);
  });

  it("prefers a machine that stands over moving to Exeora Cloud", () => {
    const impact = deletionImpact(machine, [project([laptop, desktop, cloudWithoutRoot])]);
    expect(names(impact.surviving)).toContain("Widgets");
    expect(impact.moving).toEqual([]);
  });

  it("does not count a location whose machine was removed", () => {
    const gone = deletionImpact(machine, [project([laptop, removed(desktop)])]);
    expect(names(gone.deleted)).toContain("Widgets");

    const toCloud = deletionImpact(machine, [
      project([laptop, removed(desktop), cloudWithoutRoot]),
    ]);
    expect(names(toCloud.moving)).toContain("Widgets");
    expect(toCloud.surviving).toEqual([]);
  });

  it("takes a project the list does not know as living only there", () => {
    expect(names(deletionImpact(machine, []).deleted)).toEqual([
      "Widgets",
      "Rooted",
      "Solo",
      "Half",
    ]);
  });
});
