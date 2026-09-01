import type { ComponentType } from "react";

export type ProjectStatus =
  | "live" // has a UI on this site
  | "cli-only" // runs locally; the site just documents it
  | "planned"; // listed so it's visible, not built yet

/**
 * Everything the website knows about a project.
 *
 * Keep new fields OPTIONAL. This type is the one thing shared across every
 * project, so a required addition is the only change that forces edits in all
 * of them at once.
 *
 * A manifest must stay pure data plus a lazy `load`. It is imported by client
 * components, so it must never reach into server-only modules.
 */
export type ProjectManifest = {
  slug: string;
  name: string;
  /** One line, shown in the sidebar and on the index card. */
  description: string;
  status: ProjectStatus;
  /** Longer prose for the project's own page. */
  details?: string;
  /** For cli-only projects: how to actually run the thing. */
  usage?: string;
  /** Where the code lives, relative to the repo root. */
  path?: string;
  /**
   * The project's UI, loaded on demand so one project's dependencies never
   * land in another project's bundle. Omit for projects with no web interface.
   */
  load?: () => Promise<{ default: ComponentType }>;
};
