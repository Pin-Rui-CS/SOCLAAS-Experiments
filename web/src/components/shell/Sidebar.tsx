"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
const USAGE_CHANGED_EVENT = "soclaas:usage-changed";

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
  /**
   * Credits spent this session that the provider has not yet admitted to.
   *
   * Cleared per provider as soon as the server's own figure reaches or passes
   * ours, so this never double-counts — it only ever fills the gap while the
   * provider's reporting catches up.
   */
  const [pending, setPending] = useState<Record<string, number>>({});
  /** Last figure each provider reported, to measure how much it has caught up. */
  const lastReported = useRef<Record<string, number>>({});

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/budget");
      if (!response.ok) return;
      const body = (await response.json()) as {
        search: SearchUsage[];
        providers: Array<{ id: string; name: string }>;
        gateway: Gateway | null;
      };
      const fresh = body.search ?? [];

      /*
       * Draw down the local tally by however much the provider's own figure
       * moved since we last looked.
       *
       * Without this the two would stack: we would add a credit locally, the
       * provider would eventually add the same credit, and the chip would show
       * two. Reconciling against the delta means each credit is counted by
       * exactly one of the two sources at any moment.
       */
      const admitted: Record<string, number> = {};
      for (const usage of fresh) {
        const previous = lastReported.current[usage.providerId];
        if (previous !== undefined && usage.used > previous) {
          admitted[usage.providerId] = usage.used - previous;
        }
        lastReported.current[usage.providerId] = usage.used;
      }

      // Computed above rather than inside the updater: React may invoke an
      // updater twice in development, and a ref write belongs nowhere near
      // something that can run twice.
      if (Object.keys(admitted).length > 0) {
        setPending((current) => {
          const next = { ...current };
          for (const [id, count] of Object.entries(admitted)) {
            next[id] = Math.max(0, (next[id] ?? 0) - count);
          }
          return next;
        });
      }

      setUsages(fresh);
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
  }, []);

  useEffect(() => {
    // Wrapped rather than called directly: `load` only sets state after an
    // await, but the lint rule cannot see that through a direct call.
    void (async () => {
      await load();
    })();
  }, [load]);

  /*
   * Keep the balance current when a turn spends credits.
   *
   * Two mechanisms, because one is not enough. Refetching alone looks broken:
   * Tavily's usage endpoint was measured still reporting a pre-search figure
   * two minutes after the search, so the number would sit unchanged exactly
   * when someone looks at it. So the spend is also added locally, straight
   * away, and the server figure catches up behind it.
   *
   * `Math.max` is what makes the two safe together — the displayed total only
   * ever rises, so a lagging server response cannot make it jump backwards.
   */
  useEffect(() => {
    const onSpend = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { providerId?: string; credits?: number }
        | undefined;

      const spent = detail?.credits ?? 0;
      const id = detail?.providerId;
      if (spent > 0 && id) {
        setPending((current) => ({ ...current, [id]: (current[id] ?? 0) + spent }));
      }

      void load();
    };

    window.addEventListener(USAGE_CHANGED_EVENT, onSpend);
    return () => window.removeEventListener(USAGE_CHANGED_EVENT, onSpend);
  }, [load]);

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
  const reported = usages.find((usage) => usage.providerId === activeId) ?? null;

  /*
   * The provider's figure plus whatever it has not yet counted.
   *
   * `pending` is drawn down in `load()` as the provider's own number rises, so
   * a credit is never counted twice: it sits in `pending` only for the window
   * between us spending it and the provider admitting to it.
   */
  const search =
    reported && activeId
      ? { ...reported, used: reported.used + (pending[activeId] ?? 0) }
      : reported;
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
