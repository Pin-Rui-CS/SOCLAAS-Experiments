"use client";

import { Suspense, lazy, useMemo } from "react";
import { getProject } from "@/projects/registry";

/**
 * Renders a project's own UI.
 *
 * The lazy import lives here, on the client, because a manifest's `load`
 * function cannot cross the server/client boundary as a prop. This component
 * takes only a slug and does the lookup itself, which keeps the shell's
 * knowledge of any project down to "it has a slug".
 */
export function ProjectView({ slug }: { slug: string }) {
  const Component = useMemo(() => {
    const project = getProject(slug);
    if (!project?.load) return null;
    return lazy(project.load);
  }, [slug]);

  if (!Component) return null;

  return (
    <Suspense fallback={<LoadingPane />}>
      <Component />
    </Suspense>
  );
}

function LoadingPane() {
  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        placeItems: "center",
        color: "var(--text-faint)",
      }}
    >
      Loading…
    </div>
  );
}
