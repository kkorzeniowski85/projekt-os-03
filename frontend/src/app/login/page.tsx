"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { CenteredMessage, ErrorBanner } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";

type Mode = "login" | "register";

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-white/20";

export default function LoginPage() {
  const { user, ready, login, register } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace("/");
  }, [ready, user, router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register({ email, password, displayName, inviteCode });
      }
      router.replace("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udalo sie zalogowac");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <CenteredMessage>Wczytywanie…</CenteredMessage>;

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fiszki</h1>
          <p className="mt-1 text-sm opacity-70">
            {mode === "login" ? "Zaloguj sie na swoje konto" : "Zaloz konto (wymagany kod zaproszenia)"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm">E-mail</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm">Haslo</span>
            <input
              type="password"
              required
              minLength={mode === "register" ? 10 : undefined}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
            {mode === "register" && (
              <span className="block text-xs opacity-60">Minimum 10 znakow.</span>
            )}
          </label>

          {mode === "register" && (
            <>
              <label className="block space-y-1">
                <span className="text-sm">Nazwa wyswietlana</span>
                <input
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm">Kod zaproszenia</span>
                <input
                  required
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  className={inputClass}
                />
              </label>
            </>
          )}

          <ErrorBanner message={error} />

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? "…" : mode === "login" ? "Zaloguj" : "Zaloz konto"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
          className="text-sm underline opacity-70 hover:opacity-100"
        >
          {mode === "login" ? "Nie mam jeszcze konta" : "Mam juz konto"}
        </button>
      </div>
    </div>
  );
}
