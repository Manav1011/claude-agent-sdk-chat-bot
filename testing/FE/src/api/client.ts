import axios, { AxiosError } from "axios";

import type { ApiErrorBody } from "./types";

export const TOKEN_KEY = "pf_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL ?? "http://localhost:8000"}/api/v1`,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** AuthContext registers a handler (clear state + navigate). Keeps client router-free. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorBody>) => {
    const status = error.response?.status;
    const hadToken = Boolean(error.config?.headers?.Authorization);
    // A 401 on a request we sent with a token means the session died.
    // (Login's own 401 has no Authorization header and must not redirect.)
    if (status === 401 && hadToken) {
      clearToken();
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

/** Map an AxiosError to a friendly message. Never dumps raw payloads. */
export function apiErrorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!axios.isAxiosError(err)) return fallback;
  const body = err.response?.data as ApiErrorBody | undefined;
  const envelope = body?.error;
  if (!envelope) {
    return err.code === "ERR_NETWORK"
      ? "Cannot reach the server. Is the backend running?"
      : fallback;
  }
  switch (envelope.code) {
    case "unauthorized":
      return envelope.message || "Invalid email or password";
    case "email_taken":
      return "That email is already registered. Try signing in instead.";
    case "duplicate":
      return envelope.message || "That entry already exists.";
    case "in_use":
      return "This category is used by transactions or budgets and can't be deleted.";
    case "category_mismatch":
      return "That category doesn't match the transaction type.";
    case "not_an_expense_category":
      return "Budgets can only target expense categories.";
    case "not_found":
      return envelope.message || "Not found.";
    case "validation_error":
      return "Some fields need attention. Please check the form.";
    default:
      return envelope.message || fallback;
  }
}
