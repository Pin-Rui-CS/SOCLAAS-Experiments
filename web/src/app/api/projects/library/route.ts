/**
 * Route stub. The implementation lives with the rest of the project, in
 * `src/projects/library/server/`, so deleting that folder plus its registry
 * line removes the project completely.
 */
export { GET, POST } from "@/projects/library/server/handler";

/**
 * The Discuss chat (POST) streams a whole model turn, tool calls included, so it
 * needs the same wall clock as the Chat project's route. It is a ceiling, not a
 * cost: the GET views still finish in a second or two.
 */
export const maxDuration = 300;
