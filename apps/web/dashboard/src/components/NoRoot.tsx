import { Link } from "react-router";
import type { Project } from "../api.js";
import { EmptyState } from "./ui.js";

/**
 * What the Workspace tab shows for the root of a project that has none to
 * open: the project lives nowhere, or Exeora Cloud is its default location and
 * holds no instance for it.
 *
 * Neither is a failure, so neither is drawn as one. Each says what is missing
 * and sends the person to the project's page, which is where both are put
 * right.
 */
export function NoRoot({ project }: { project: Pick<Project, "id" | "name" | "locations"> }) {
  const page = (
    <Link to={`/projects/${project.id}`} className="underline">
      the project's page
    </Link>
  );
  const resting = project.locations.some((location) => location.state === "no instance");

  if (resting) {
    return (
      <EmptyState title="Exeora Cloud holds no instance for this root">
        The next call to the root of {project.name} makes one, which takes about a minute. To make
        it now, use Start instance on {page}.
      </EmptyState>
    );
  }

  return (
    <EmptyState title={`${project.name} lives nowhere`}>
      Its root cannot be opened until it has a location with a copy. Add a location on {page}.
    </EmptyState>
  );
}
