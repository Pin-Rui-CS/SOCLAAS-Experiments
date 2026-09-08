/**
 * Route stub. The implementation lives with the rest of the experiment, in
 * `src/projects/apiagent/server/`, so that deleting that one folder plus its
 * registry line removes the project completely.
 *
 * App Router requires a handler at this exact path, which is why this file
 * exists at all. `maxDuration` is declared here rather than re-exported because
 * Next reads route segment config statically and may not follow a re-export.
 */
export { POST } from "@/projects/apiagent/server/handler";

/** Total wall clock for the whole turn, tool calls included. */
export const maxDuration = 300;
