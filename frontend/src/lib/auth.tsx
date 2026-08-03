"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api, refreshSession, setAccessToken } from "@/lib/api";
import type { User } from "@/lib/types";

interface AuthState {
  user: User | null;
  /** false dopoki nie wiemy, czy istnieje wazna sesja - blokuje mignięcie logowania. */
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  inviteCode: string;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const loadUser = useCallback(async () => {
    const me = await api<User>("/auth/me");
    setUser(me);
  }, []);

  useEffect(() => {
    // Po odswiezeniu strony access token z pamieci przepadl, ale ciasteczko
    // refresh zostalo - probujemy odtworzyc sesje bez pytania o haslo.
    (async () => {
      if (await refreshSession()) {
        try {
          await loadUser();
        } catch {
          setUser(null);
        }
      }
      setReady(true);
    })();
  }, [loadUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api<{ access_token: string }>("/auth/login", {
        method: "POST",
        body: { email, password },
        auth: false,
      });
      setAccessToken(data.access_token);
      await loadUser();
    },
    [loadUser],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const data = await api<{ access_token: string }>("/auth/register", {
        method: "POST",
        body: {
          email: input.email,
          password: input.password,
          display_name: input.displayName,
          invite_code: input.inviteCode,
        },
        auth: false,
      });
      setAccessToken(data.access_token);
      await loadUser();
    },
    [loadUser],
  );

  const logout = useCallback(async () => {
    try {
      await api<void>("/auth/logout", { method: "POST" });
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, register, logout }),
    [user, ready, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth musi byc uzyte wewnatrz <AuthProvider>");
  }
  return context;
}
