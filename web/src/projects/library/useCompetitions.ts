"use client";

import { useEffect, useMemo, useState } from "react";
import { getJson } from "./api";
import type { Competition, LibraryItem } from "./types";

/**
 * Fill in each forecast's competition.
 *
 * Rows published from 2026-09-27 carry `raw.tournaments`; older ones carry at
 * most a bare slug. Those are looked up from Metaculus, ONE AT A TIME — the
 * server spaces Metaculus calls 3s apart, so parallel requests would only
 * queue there — and each answer is kept in localStorage. Tournament membership
 * does not change, so a question is asked about once per browser.
 */

const STORAGE_KEY = "soclaas.library.tournaments";

function readCache(): Record<string, Competition[]> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeCache(postId: number, competitions: Competition[]) {
  try {
    const cache = readCache();
    cache[postId] = competitions;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable — the lookup simply repeats next visit
  }
}

const needsLookup = (item: LibraryItem) =>
  item.postId != null && (item.competitions === null || item.competitions.some((c) => !c.name));

export function useCompetitions(items: LibraryItem[] | null) {
  // Read once the list has arrived; never during server rendering.
  const cached = useMemo(() => (items ? readCache() : {}), [items]);
  const [fetched, setFetched] = useState<Record<number, Competition[]>>({});
  const [failed, setFailed] = useState<string | null>(null);

  const queue = useMemo(() => {
    if (!items) return [];
    const posts = items.filter(needsLookup).map((i) => i.postId!);
    return [...new Set(posts)].filter((p) => !(p in cached));
  }, [items, cached]);

  useEffect(() => {
    if (!queue.length) return;
    let cancelled = false;
    (async () => {
      for (const postId of queue) {
        if (cancelled) return;
        try {
          const { competitions } = await getJson<{ competitions: Competition[] }>(`view=tournaments&post=${postId}`);
          if (cancelled) return;
          writeCache(postId, competitions);
          setFetched((all) => ({ ...all, [postId]: competitions }));
        } catch (error) {
          // No token, or Metaculus refusing: stop rather than hammer it.
          if (!cancelled) setFailed(error instanceof Error ? error.message : String(error));
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queue]);

  const merged = useMemo(
    () =>
      items?.map((item) => {
        const found = item.postId != null ? fetched[item.postId] ?? cached[item.postId] : undefined;
        return found ? { ...item, competitions: found } : item;
      }) ?? null,
    [items, fetched, cached],
  );

  const pending = failed ? 0 : queue.filter((p) => !(p in fetched)).length;
  return { items: merged, pending, failed };
}
