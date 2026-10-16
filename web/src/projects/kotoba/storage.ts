import type { Store } from "./types";

/**
 * Decks and progress in localStorage.
 *
 * Everything lives under one key so a backup is one JSON document and a
 * restore cannot leave decks and cards out of step. The whole store is small
 * — a card is a few hundred bytes including its five remembered sentences —
 * so a few thousand words sit well inside the ~5MB budget.
 *
 * Every access is wrapped: private windows and blocked storage throw here,
 * and neither should stop the page rendering.
 */

const KEY = "soclaas.kotoba.v1";

export function emptyStore(): Store {
  return { v: 1, decks: [], cards: [], today: { day: "", studied: 0, newByDeck: {} } };
}

function isStore(value: unknown): value is Store {
  const v = value as Store | null;
  return (
    !!v &&
    v.v === 1 &&
    Array.isArray(v.decks) &&
    Array.isArray(v.cards) &&
    typeof v.today === "object" &&
    v.today !== null
  );
}

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const parsed: unknown = JSON.parse(raw);
    return isStore(parsed) ? parsed : emptyStore();
  } catch {
    return emptyStore();
  }
}

/*
 * Whether the last save failed, as a tiny external store so the view can
 * show a warning without mirroring it into React state from an effect.
 */
let saveFailed = false;
const saveListeners = new Set<() => void>();

export function subscribeSaveFailed(listener: () => void) {
  saveListeners.add(listener);
  return () => {
    saveListeners.delete(listener);
  };
}

export function getSaveFailed(): boolean {
  return saveFailed;
}

export function saveStore(store: Store): boolean {
  let ok: boolean;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    ok = true;
  } catch {
    ok = false;
  }
  if (saveFailed === ok) {
    saveFailed = !ok;
    saveListeners.forEach((listener) => listener());
  }
  return ok;
}

export function exportStore(store: Store): string {
  return JSON.stringify(store, null, 2);
}

/** Throws with a readable message when the file is not a Kotoba backup. */
export function parseBackup(text: string): Store {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!isStore(parsed)) throw new Error("That file is not a Kotoba backup.");
  return parsed;
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `k_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
