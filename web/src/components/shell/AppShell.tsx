"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SidebarContent } from "./Sidebar";

/**
 * Fixed left rail on desktop, off-canvas drawer under 768px.
 *
 * The shell knows nothing about any project beyond what the registry exposes;
 * it renders whatever the route puts in `children`.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Navigating should never leave the drawer covering the page.
  useEffect(() => setDrawerOpen(false), [pathname]);

  // Escape closes the drawer, as any overlay should.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const sidebarVisible = !isNarrow || drawerOpen;

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {isNarrow && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 40,
          }}
        />
      )}

      <aside
        style={{
          width: "var(--sidebar-w)",
          flexShrink: 0,
          background: "var(--bg-subtle)",
          borderRight: "1px solid var(--border)",
          ...(isNarrow
            ? {
                position: "fixed",
                insetBlock: 0,
                left: 0,
                zIndex: 50,
                transform: drawerOpen ? "translateX(0)" : "translateX(-100%)",
                transition: "transform 160ms ease",
              }
            : {}),
          ...(sidebarVisible || isNarrow ? {} : { display: "none" }),
        }}
      >
        <SidebarContent onNavigate={() => setDrawerOpen(false)} />
      </aside>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {isNarrow && (
          <div
            style={{
              padding: "8px 12px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open project menu"
              style={{
                background: "var(--bg-raised)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              ☰ Projects
            </button>
          </div>
        )}

        <main style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>{children}</main>
      </div>
    </div>
  );
}
