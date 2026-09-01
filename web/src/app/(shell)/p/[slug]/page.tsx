import { notFound } from "next/navigation";
import { getProject } from "@/projects/registry";
import { ProjectView } from "@/components/shell/ProjectView";

/*
 * Deliberately NOT prerendered.
 *
 * A statically prerendered page is a file in Vercel's CDN, which is exactly
 * the sort of thing that can be served without consulting the auth gate.
 * Everything behind the password renders on demand instead.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = getProject(slug);
  return { title: project ? `${project.name} — SoCLaaS` : "Not found" };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = getProject(slug);

  if (!project) notFound();

  // Projects with a UI own the whole pane, including their own scrolling.
  if (project.load) return <ProjectView slug={slug} />;

  // Everything else gets a documentation page generated from the manifest.
  return (
    <div style={{ height: "100%", overflowY: "auto" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 28px 64px" }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          {project.name}
        </h1>
        <p style={{ color: "var(--text-muted)", marginTop: 6 }}>
          {project.description}
        </p>

        {project.status === "cli-only" && (
          <div
            style={{
              marginTop: 20,
              padding: "10px 14px",
              borderRadius: "var(--radius)",
              background: "var(--warn-bg)",
              border: "1px solid var(--warn-border)",
              color: "var(--warn-text)",
              fontSize: 13,
            }}
          >
            This project runs on your machine, not on this site.
          </div>
        )}

        {project.details && (
          <div style={{ marginTop: 24, whiteSpace: "pre-wrap" }}>
            {project.details}
          </div>
        )}

        {project.usage && (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 600, marginTop: 32 }}>Usage</h2>
            <pre
              style={{
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: 14,
                fontSize: 12.5,
                fontFamily: "var(--font-mono)",
                lineHeight: 1.65,
              }}
            >
              {project.usage}
            </pre>
          </>
        )}

        {project.path && (
          <p style={{ color: "var(--text-faint)", fontSize: 13, marginTop: 24 }}>
            Source:{" "}
            <code style={{ fontFamily: "var(--font-mono)" }}>{project.path}</code>
          </p>
        )}
      </div>
    </div>
  );
}
