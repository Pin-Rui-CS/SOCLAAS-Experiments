import Link from "next/link";
import { projects } from "@/projects/registry";

const STATUS_LABEL = {
  live: "Live",
  "cli-only": "Command line",
  planned: "Planned",
} as const;

// Not prerendered: see the note in p/[slug]/page.tsx.
export const dynamic = "force-dynamic";

export default function IndexPage() {
  return (
    <div style={{ height: "100%", overflowY: "auto" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "48px 28px 64px" }}>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Projects
        </h1>
        <p style={{ color: "var(--text-muted)", marginTop: 6, marginBottom: 32 }}>
          Experiments running on the NUS SoC LLM gateway.
        </p>

        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          }}
        >
          {projects.map((project) => (
            <Link
              key={project.slug}
              href={`/p/${project.slug}`}
              style={{
                display: "block",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: 16,
                background: "var(--bg-raised)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span style={{ fontWeight: 600 }}>{project.name}</span>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-faint)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    padding: "1px 6px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {STATUS_LABEL[project.status]}
                </span>
              </div>
              <p
                style={{
                  color: "var(--text-muted)",
                  margin: "8px 0 0",
                  fontSize: 13,
                }}
              >
                {project.description}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
