/**
 * Route stub. The implementation lives with the rest of the project, in
 * `src/projects/library/server/`, so deleting that folder plus its registry
 * line removes the project completely.
 */
export { GET } from "@/projects/library/server/handler";

/** A research.md can be several hundred KB and the first request may sign in. */
export const maxDuration = 30;
