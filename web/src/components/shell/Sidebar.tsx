"use client";

import { useEffect, useState } from "react";
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
        <BudgetChip />
        <LogoutButton />
      </div>
    </nav>
  );
}

type Gateway = {
  daySpend: number;
  dayAllowance: number;
  monthSpend: number;
  monthAllowance: number;
  requestsPerMinute: number;
};

type SearchUsage = {
  providerId: string;
  provider: string;
  used: number;
  limit: number | null;
  window: "month" | "day";
  source: "api" | "headers";
};

/*
 * Kept in step with the chat's provider picker.
 *
 * Duplicated rather than imported: this is the shell, and importing from a
 * project would invert the dependency the registry deliberately enforces. Two
 * string constants are a smaller price than that coupling.
 */
const SEARCH_PROVIDER_STORAGE_KEY = "soclaas.chat.searchProvider";
const SEARCH_PROVIDER_EVENT = "soclaas:search-provider";

function readSelectedProvider(): string | null {
  try {
    return localStorage.getItem(SEARCH_PROVIDER_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Microdollars to something readable. 1e6 microdollars = $1. */
function dollars(microdollars: number): string {
  const value = microdollars / 1e6;
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/**
 * What is left of the finite allowance.
 *
 * SEARCH is the headline, not gateway spend. The gateway gives $50 a day
 * against turns costing fractions of a cent — it is never going to be the thing
 * that stops working. A free search tier is a thousand calls a month, and when
 * those are gone the web toggle fails quietly. That is the number worth a
 * permanent place on screen; gateway spend moves to the tooltip.
 *
 * Any part being unavailable is normal rather than an error: the SoCLaaS portal
 * is NUS-network-only, and Brave reports its quota only after a search has run.
 * Each simply drops out of the display.
 */
function BudgetChip() {
  const [usages, setUsages] = useState<SearchUsage[]>([]);
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [gateway, setGateway] = useState<Gateway | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/budget");
        if (!response.ok) return;
        const body = (await response.json()) as {
          search: SearchUsage[];
          providers: Array<{ id: string; name: string }>;
          gateway: Gateway | null;
        };
        if (cancelled) return;
        setUsages(body.search ?? []);
        setProviders(body.providers ?? []);
        setGateway(body.gateway);
        // Read here rather than in an effect body: localStorage is unavailable
        // during SSR, so it cannot seed useState without a hydration mismatch,
        // and setting it synchronously in an effect is the cascading-render
        // pattern React warns about. After an await it is neither.
        setSelected(readSelectedProvider());
      } catch {
        /* leave the label as it was */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Follow the chat's picker. The custom event covers this tab; `storage`
  // covers the same site open in another one.
  useEffect(() => {
    const sync = () => setSelected(readSelectedProvider());
    window.addEventListener(SEARCH_PROVIDER_EVENT, sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener(SEARCH_PROVIDER_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  /*
   * Only ever the SELECTED provider's balance.
   *
   * Never another provider's as a fallback: showing "Tavily 996 left" while
   * someone is spending Brave's allowance is worse than showing no number,
   * because it reads as reassurance about the wrong account.
   */
  const activeId = selected ?? providers[0]?.id ?? null;
  const search = usages.find((usage) => usage.providerId === activeId) ?? null;
  const activeName =
    providers.find((provider) => provider.id === activeId)?.name ?? null;

  const gatewayLines = gateway
    ? [
        `Gateway today: ${dollars(gateway.daySpend)} of ${dollars(gateway.dayAllowance)}`,
        `Gateway month: ${dollars(gateway.monthSpend)} of ${dollars(gateway.monthAllowance)}`,
        `${gateway.requestsPerMinute} requests/min, resets 00:00 UTC (08:00 SGT)`,
      ]
    : ["Gateway usage unavailable (the portal is NUS-network-only)."];

  if (!search) {
    // Configured but silent — Brave's free plan publishes no monthly window.
    // Name it anyway, so it is clear which provider is in use and that the
    // blank is the provider's doing rather than a broken chip.
    const label = activeName ? `${activeName} · usage not reported` : "NUS SoC gateway";
    return (
      <span
        title={[
          activeName
            ? `${activeName} does not publish a remaining-quota figure, so there is nothing to count. Check its own dashboard.`
            : "No search provider configured.",
          "",
          ...gatewayLines,
        ].join("\n")}
      >
        {label}
      </span>
    );
  }

  const left = search.limit === null ? null : search.limit - search.used;

  return (
    <span
      title={[
        search.limit === null
          ? `${search.provider}: ${search.used} searches used this ${search.window}; the provider does not publish a limit.`
          : `${search.provider}: ${left} of ${search.limit} searches left this ${search.window}.`,
        search.source === "headers"
          ? "Read from the last search's response headers, so it updates only after a search."
          : "Read live from the provider's usage endpoint.",
        // Every other configured provider, so switching is an informed choice
        // rather than a guess about what is left on the other one.
        ...usages
          .filter((usage) => usage.providerId !== search.providerId)
          .map((usage) =>
            usage.limit === null
              ? `Also configured — ${usage.provider}: ${usage.used} used this ${usage.window}.`
              : `Also configured — ${usage.provider}: ${usage.limit - usage.used} of ${usage.limit} left this ${usage.window}.`,
          ),
        "",
        ...gatewayLines,
      ].join("\n")}
      style={{
        // The only state worth colouring: nearly out, and about to fail quietly.
        color:
          left !== null && search.limit !== null && left <= search.limit * 0.1
            ? "var(--danger)"
            : undefined,
      }}
    >
      {/* Named, because with two configured it is otherwise ambiguous which
        * allowance this is counting down. */}
      {left === null
        ? `${search.provider} ${search.used} used`
        : `${search.provider} ${left} left`}
    </span>
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
