import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

import { login as loginApi, me as meApi, register as registerApi } from "../api/endpoints";
import { clearToken, getToken, setToken, setUnauthorizedHandler } from "../api/client";
import type { User } from "../api/types";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>(() =>
    getToken() ? "loading" : "unauthenticated",
  );
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const sessionEnded = useCallback(() => {
    clearToken();
    setUser(null);
    setStatus("unauthenticated");
    queryClient.clear();
  }, [queryClient]);

  // Session bootstrap: validate a stored token once on mount.
  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    meApi()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        sessionEnded();
      });
    return () => {
      cancelled = true;
    };
  }, [sessionEnded]);

  // A 401 from any authenticated request ends the session.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      sessionEnded();
      navigate("/auth/signin", { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [sessionEnded, navigate]);

  const login = useCallback(async (email: string, password: string) => {
    const token = await loginApi(email, password);
    setToken(token.access_token);
    const u = await meApi();
    setUser(u);
    setStatus("authenticated");
  }, []);

  const signup = useCallback(
    async (email: string, password: string) => {
      await registerApi(email, password);
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(() => {
    sessionEnded();
    navigate("/auth/signin");
  }, [sessionEnded, navigate]);

  const value = useMemo(
    () => ({ user, status, login, signup, logout }),
    [user, status, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
