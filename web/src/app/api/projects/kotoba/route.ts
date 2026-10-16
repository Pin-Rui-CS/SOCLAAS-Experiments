/**
 * Route stub. The implementation lives with the rest of the project, in
 * `src/projects/kotoba/server/`, so deleting that folder plus its registry
 * line removes the project completely.
 */
export { POST } from "@/projects/kotoba/server/handler";

/** A ten-word batch takes seconds; a retry doubles it. Generous headroom. */
export const maxDuration = 60;
