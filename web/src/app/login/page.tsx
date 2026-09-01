"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Sign in failed.");
        setBusy(false);
        return;
      }

      const next = searchParams.get("next");
      // Only allow same-origin paths, so ?next= can't be used as an open redirect.
      router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <form
        onSubmit={onSubmit}
        style={{
          width: "100%",
          maxWidth: 340,
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 24,
          background: "var(--bg-raised)",
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>SoCLaaS Experiments</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6 }}>
          This site spends a personal API quota, so it is password protected.
        </p>

        <label
          htmlFor="password"
          style={{ display: "block", fontSize: 13, marginTop: 20, marginBottom: 6 }}
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            width: "100%",
            padding: "9px 11px",
            borderRadius: "var(--radius)",
            border: "1px solid var(--border-strong)",
            background: "var(--bg)",
          }}
        />

        {error && (
          <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 12, marginBottom: 0 }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || password.length === 0}
          style={{
            width: "100%",
            marginTop: 18,
            padding: "9px 12px",
            borderRadius: "var(--radius)",
            border: "none",
            background: busy ? "var(--border-strong)" : "var(--accent)",
            color: "var(--accent-fg)",
            fontWeight: 550,
            cursor: busy || !password ? "default" : "pointer",
            opacity: !busy && password.length === 0 ? 0.5 : 1,
          }}
        >
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
