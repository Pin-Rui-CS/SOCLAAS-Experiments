"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { projects, type ProjectStatus } from "@/projects/registry";

const GROUPS: { status: ProjectStatus; label: string }[] = [
  { status: "live", label: "Projects" },
  { status: "cli-only", label: "Command line" },
  { status: "planned", label: "Planned" },
];

const STATUS_HINT: Record<ProjectStatus, string | null> = {
  live: null,
  "cli-only": "CLI",
  planned: "Soon",
};

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Projects"
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      <div
        style={{
          padding: "18px 18px 14px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Link
          href="/"
          onClick={onNavigate}
          style={{ display: "block", fontWeight: 600, letterSpacing: "-0.01em" }}
        >
          SoCLaaS
        </Link>
        <div style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 2 }}>
          Experiments
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 10px" }}>
        {GROUPS.map(({ status, label }) => {
          const inGroup = projects.filter((p) => p.status === status);
          if (inGroup.length === 0) return null;

          return (
            <section key={status} style={{ marginBottom: 18 }}>
              <h2
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--text-faint)",
                  margin: "0 0 6px",
                  padding: "0 8px",
                }}
              >
                {label}
              </h2>

              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {inGroup.map((project) => {
                  const href = `/p/${project.slug}`;
                  const active = pathname === href;
                  const hint = STATUS_HINT[project.status];

                  return (
                    <li key={project.slug}>
                      <Link
                        href={href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "7px 8px",
                          borderRadius: "var(--radius)",
                          background: active ? "var(--bg-active)" : "transparent",
                          color: active ? "var(--text)" : "var(--text-muted)",
                          fontWeight: active ? 550 : 450,
                        }}
                      >
                        <span
                          style={{
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {project.name}
                        </span>
                        {hint && (
                          <span
                            style={{
                              fontSize: 10,
                              color: "var(--text-faint)",
                              border: "1px solid var(--border)",
                              borderRadius: 4,
                              padding: "0 4px",
                            }}
                          >
                            {hint}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <div
        style={{
          padding: "10px 18px",
          borderTop: "1px solid var(--border)",
          fontSize: 12,
          color: "var(--text-faint)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>NUS SoC gateway</span>
        <LogoutButton />
      </div>
    </nav>
  );
}

function LogoutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/auth", { method: "DELETE" });
        window.location.href = "/login";
      }}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        color: "var(--text-faint)",
        textDecoration: "underline",
        fontSize: 12,
      }}
    >
      Sign out
    </button>
  );
}
