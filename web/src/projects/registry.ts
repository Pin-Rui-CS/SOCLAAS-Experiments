import type { ProjectManifest } from "./types";
import { apiAgentManifest } from "./apiagent/manifest";
import { chatManifest } from "./chat/manifest";
import { forecasterManifest } from "./forecaster/manifest";

/**
 * The single place that knows every project exists.
 *
 * The shell reads this and nothing else from any project. Projects never
 * import each other. Adding one means: create its folder, write a manifest,
 * add a line here.
 *
 * Deliberately a hand-written array rather than a generated glob — codegen
 * would trade a remembered line for build magic, which is a bad trade at this
 * size. Worth revisiting at three or four projects.
 */
export const projects: ProjectManifest[] = [
  chatManifest,
  apiAgentManifest,
  forecasterManifest,
];

export function getProject(slug: string): ProjectManifest | undefined {
  return projects.find((project) => project.slug === slug);
}

export type { ProjectManifest, ProjectStatus } from "./types";
