"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { SidebarContent } from "./Sidebar";

/*
 * Desktop collapse, remembered per browser. An external store rather than
 * effect-set state: the server renders expanded, the client reads storage, and
 * React reconciles the two without a hydration mismatch. The in-memory value
 * keeps the toggle working when storage is blocked.
 */
const COLLAPSE_KEY = "soclaas.sidebar.collapsed";
const collapseListeners = new Set<() => void>();
let collapsedInMemory = false;

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return collapsedInMemory;
  }
}

function writeCollapsed(value: boolean) {
  collapsedInMemory = value;
  try {
    localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0");
  } catch {
    // storage blocked: the in-memory value still applies for this page
  }
  collapseListeners.forEach((listener) => listener());
}

function subscribeCollapsed(listener: () => void) {
  collapseListeners.add(listener);
  // Another tab toggling it keeps this one in step.
  const onStorage = (e: StorageEvent) => e.key === COLLAPSE_KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    collapseListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const RAIL_W = 48;

/** Toggle, then hand focus to the button that replaces the one just pressed. */
function toggleSidebar(collapse: boolean) {
  writeCollapsed(collapse);
  requestAnimationFrame(() =>
    document.getElementById(collapse ? "sidebar-expand" : "sidebar-collapse")?.focus(),
  );
}

/**
 * Fixed left rail on desktop — collapsible to a thin strip — and an
 * off-canvas drawer under 768px.
 *
 * The shell knows nothing about any project beyond what the registry exposes;
 * it renders whatever the route puts in `children`.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const railed = collapsed && !isNarrow;

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
          width: railed ? RAIL_W : "var(--sidebar-w)",
          flexShrink: 0,
          background: "var(--bg-subtle)",
          borderRight: "1px solid var(--border)",
          overflow: "hidden",
          transition: isNarrow ? undefined : "width 160ms ease",
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
        {railed && (
          <div style={{ padding: "14px 0", display: "flex", justifyContent: "center" }}>
            <button
              type="button"
              id="sidebar-expand"
              onClick={() => toggleSidebar(false)}
              aria-label="Expand sidebar"
              aria-expanded={false}
              title="Expand sidebar"
              style={railButton}
            >
              »
            </button>
          </div>
        )}
        {/*
         * Hidden, not unmounted, while collapsed: the budget chip keeps its
         * polling and cached figures instead of starting over on every toggle.
         */}
        <div style={{ height: "100%", width: "var(--sidebar-w)", display: railed ? "none" : "block" }}>
          <SidebarContent
            onNavigate={() => setDrawerOpen(false)}
            onCollapse={isNarrow ? undefined : () => toggleSidebar(true)}
          />
        </div>
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

const railButton = {
  width: 30,
  height: 30,
  display: "grid",
  placeItems: "center",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  background: "var(--bg-raised)",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 15,
  lineHeight: 1,
} as const;
