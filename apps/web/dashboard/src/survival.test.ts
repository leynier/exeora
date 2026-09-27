import { describe, expect, it } from "vitest";
import type { CloudInstance, LocalMachine } from "./api-projects.js";
import type { Project, ProjectLocation } from "./api-types.js";
import {
  deletionImpact,
  destroySentence,
  hasRepository,
  isLastLocation,
  isLeaving,
  livesNowhere,
  livesOnlyOnCloud,
  removalBlocker,
  removalSentence,
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
/** Exeora Cloud as the default location of a project whose root instance is gone. */
const cloudAtRest = location({ ...cloudWithoutRoot, default: true, state: "no instance" });
const removed = (entry: ProjectLocation): ProjectLocation => ({
  ...entry,
  online: false,
  state: "removed",
});

type Patch = Partial<Pick<Project, "id" | "repoUrl" | "cloud" | "nowhere">>;

/** A repository, unless the patch says it is a directory with no remote. */
const project = (locations: ProjectLocation[], patch: Patch = {}) => ({
  id: "prj_widgets",
  repoUrl: "https://github.com/example/widgets.git" as string | null,
  cloud: null as Project["cloud"],
  nowhere: false,
  locations,
  ...patch,
});
const directory = (locations: ProjectLocation[], patch: Patch = {}) =>
  project(locations, { repoUrl: null, ...patch });

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

describe("hasRepository", () => {
  it("is a project with a remote, or one that is on Exeora Cloud", () => {
    expect(hasRepository(project([laptop]))).toBe(true);
    expect(hasRepository(directory([laptop]))).toBe(false);
    const onCloud = {
      repoUrl: "https://example.com/w.git",
      defaultBranch: "main",
      hasCredential: false,
    };
    expect(hasRepository(directory([cloud], { cloud: onCloud }))).toBe(true);
  });
});

describe("livesNowhere", () => {
  it("is a project with no default machine and no location that stands", () => {
    expect(livesNowhere(project([], { nowhere: true }))).toBe(true);
    // The record of a removed machine is not somewhere it lives.
    expect(livesNowhere(project([removed(laptop)], { nowhere: true }))).toBe(true);
    expect(livesNowhere(project([laptop]))).toBe(false);
  });

  it("is not a project on Exeora Cloud with no instance, which has a place at rest", () => {
    expect(livesNowhere(project([cloudAtRest], { nowhere: true }))).toBe(false);
  });
});

describe("livesOnlyOnCloud", () => {
  it("is true only when no machine of the person holds the project", () => {
    expect(livesOnlyOnCloud(project([cloud]))).toBe(true);
    expect(livesOnlyOnCloud(project([laptop, cloud]))).toBe(false);
    expect(livesOnlyOnCloud(project([]))).toBe(false);
  });

  it("does not count a machine that was removed as somewhere the project lives", () => {
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

  it("does not call a project leaving when only its root instance was destroyed", () => {
    // The project has no default machine from the moment the instance was
    // asked to go, and it stays.
    expect(isLeaving(project([cloudAtRest], { nowhere: true }), [instance("removing")])).toBe(
      false,
    );
  });
});

describe("isLastLocation", () => {
  it("is the only location that still stands", () => {
    expect(isLastLocation(project([laptop]), laptop)).toBe(true);
    expect(isLastLocation(project([laptop, removed(desktop)]), laptop)).toBe(true);
    expect(isLastLocation(project([laptop, cloud]), laptop)).toBe(false);
  });

  it("is never the record of a removed machine", () => {
    expect(isLastLocation(project([removed(laptop)]), removed(laptop))).toBe(false);
  });
});

describe("removalBlocker", () => {
  it("offers the last location of a repository, default or not", () => {
    expect(removalBlocker(project([laptop]), laptop)).toBeNull();
    expect(removalBlocker(project([{ ...cloud, default: true }]), cloud)).toBeNull();
    expect(removalBlocker(project([cloudAtRest], { nowhere: true }), cloudAtRest)).toBeNull();
    // The other is the record of a removed machine, which is no place to live.
    expect(removalBlocker(project([laptop, removed(desktop)]), laptop)).toBeNull();
  });

  it("refuses the last location of a directory with no remote, in the gateway's words", () => {
    expect(removalBlocker(directory([laptop]), laptop)).toBe(
      "This project is a directory on this machine and lives nowhere else. Remove the project instead.",
    );
    expect(removalBlocker(directory([laptop, removed(desktop)]), laptop)).toContain(
      "Remove the project instead",
    );
  });

  it("refuses the default location while others stand", () => {
    expect(removalBlocker(project([laptop, cloud]), laptop)).toBe(
      "Choose another default location before removing this one.",
    );
    expect(removalBlocker(project([laptop, cloud]), cloud)).toBeNull();
  });

  it("says how to move a default that was removed and has nothing to take its place", () => {
    const gone = removed(laptop);
    expect(removalBlocker(project([gone]), gone)).toContain("Add a location");
    expect(removalBlocker(project([gone, desktop]), gone)).toContain("another default");
  });

  it("lets the record of a removed machine be cleaned up", () => {
    expect(removalBlocker(project([laptop, removed(desktop)]), removed(desktop))).toBeNull();
  });
});

describe("removalSentence", () => {
  it("says the project stays and lives nowhere when its last location goes", () => {
    const stays =
      "The project stays, with its address, policy and clients, and lives nowhere until it is given a location.";
    expect(removalSentence(project([laptop]), laptop)).toBe(
      `Exeora forgets that the project lives on this machine, the only place it lives. ${stays} This removes:`,
    );
    expect(removalSentence(project([{ ...cloud, default: true }]), cloud)).toBe(
      `The project is taken off Exeora Cloud, the only place it lives. ${stays} This destroys:`,
    );
  });

  it("says the project stays in its other locations while it has them", () => {
    expect(removalSentence(project([laptop, cloud]), cloud)).toBe(
      "The project is taken off Exeora Cloud and stays in its other locations. This destroys:",
    );
    expect(removalSentence(project([laptop, desktop]), desktop)).toBe(
      "Exeora forgets that the project lives on this machine. This removes:",
    );
    expect(removalSentence(project([laptop, removed(desktop)]), removed(desktop))).not.toContain(
      "lives nowhere",
    );
  });
});

describe("destroySentence", () => {
  const root = instance("asleep");
  const lost =
    "This is the copy of Widgets that Exeora Cloud runs. Anything on it that was not pushed is lost, because the instance is the only copy of that.";
  const stays = "The project stays, with its address, policy and clients";

  it("never says the project goes, wherever it lives", () => {
    const cases = [
      project([{ ...cloud, default: true }]),
      project([removed(laptop), { ...cloud, default: true }]),
      project([laptop, cloud]),
      project([
        { ...laptop, default: false },
        { ...cloud, default: true },
      ]),
      undefined,
    ];
    for (const entry of cases) {
      const sentence = destroySentence(root, entry);
      expect(sentence.startsWith(`${lost} ${stays}`)).toBe(true);
      expect(sentence).not.toMatch(/removed|deleted|goes with/);
    }
  });

  it("says another instance is made for a project that lives only on Exeora Cloud", () => {
    const again =
      "The next call to its root makes another instance, and so does Start instance on the project's page.";
    expect(destroySentence(root, project([{ ...cloud, default: true }]))).toBe(
      `${lost} ${stays}. ${again}`,
    );
    // A machine that was removed is not somewhere to move the default to.
    expect(
      destroySentence(root, project([removed(laptop), { ...cloud, default: true }])),
    ).toContain(again);
  });

  it("says where the default goes for a project that lives on a machine too", () => {
    expect(
      destroySentence(
        root,
        project([
          { ...laptop, default: false },
          { ...cloud, default: true },
        ]),
      ),
    ).toBe(`${lost} ${stays}, and its default location moves to one of your machines.`);
    expect(destroySentence(root, project([laptop, cloud]))).toBe(
      `${lost} ${stays}, and keeps its other locations.`,
    );
  });

  it("promises nothing about the root of a project it does not know", () => {
    expect(destroySentence(root, undefined)).toBe(`${lost} ${stays}.`);
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
      held("prj_folder", "Folder"),
    ],
  };
  const names = (list: Array<{ name: string }>) => list.map((entry) => entry.name);

  it("sorts what the machine holds by what happens to it", () => {
    const impact = deletionImpact(machine, [
      project([laptop, desktop]),
      // Cloud runs an instance for the root, so there is a machine to carry on from.
      project([laptop, cloud], { id: "prj_rooted" }),
      // A repository that lives only here stays, with nowhere to live.
      project([laptop], { id: "prj_solo" }),
      // Cloud holds workspaces only: it becomes the default, with no instance.
      project([laptop, cloudWithoutRoot], { id: "prj_half" }),
      // A directory with no remote is the copy on this machine and nothing else.
      directory([laptop], { id: "prj_folder" }),
    ]);

    expect(names(impact.surviving)).toEqual(["Widgets", "Rooted"]);
    expect(names(impact.nowhere)).toEqual(["Solo"]);
    expect(names(impact.resting)).toEqual(["Half"]);
    expect(names(impact.deleted)).toEqual(["Folder"]);
  });

  it("deletes no repository, whatever else is gone", () => {
    const impact = deletionImpact(machine, [
      project([laptop, removed(desktop)]),
      project([laptop], { id: "prj_rooted" }),
      project([laptop], { id: "prj_solo" }),
      project([laptop], { id: "prj_half" }),
      project([laptop], { id: "prj_folder" }),
    ]);
    expect(impact.deleted).toEqual([]);
    expect(names(impact.nowhere)).toEqual(["Widgets", "Rooted", "Solo", "Half", "Folder"]);
  });

  it("prefers a machine that stands over Exeora Cloud with no instance", () => {
    const impact = deletionImpact(machine, [project([laptop, desktop, cloudWithoutRoot])]);
    expect(names(impact.surviving)).toContain("Widgets");
    expect(impact.resting).toEqual([]);
  });

  it("does not count a location whose machine was removed", () => {
    const gone = deletionImpact(machine, [project([laptop, removed(desktop)])]);
    expect(names(gone.nowhere)).toContain("Widgets");
    expect(gone.surviving).toEqual([]);

    const folder = deletionImpact(machine, [directory([laptop, removed(desktop)])]);
    expect(names(folder.deleted)).toContain("Widgets");

    const toCloud = deletionImpact(machine, [
      project([laptop, removed(desktop), cloudWithoutRoot]),
    ]);
    expect(names(toCloud.resting)).toContain("Widgets");
    expect(toCloud.surviving).toEqual([]);
  });

  it("takes a project the list does not know for a directory, and warns of its deletion", () => {
    expect(names(deletionImpact(machine, []).deleted)).toEqual([
      "Widgets",
      "Rooted",
      "Solo",
      "Half",
      "Folder",
    ]);
  });
});
