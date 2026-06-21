/**
 * Client-side auth state hook.
 *
 * Provides a boolean `isLoggedIn` for UI hints (header links, nav guards).
 * This is NOT a security check — actual auth verification happens server-side
 * via getClaims() / getUser() in server functions and beforeLoad guards.
 *
 * SSR-safe: returns false during SSR, checks real session after hydration.
 */
import { useState, useEffect, useSyncExternalStore } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

let cachedLoggedIn = false;
const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): boolean {
  return cachedLoggedIn;
}

function getServerSnapshot(): boolean {
  return false;
}

function notify() {
  for (const cb of listeners) cb();
}

// Initialize on first client load
let initialized = false;
function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const supabase = getSupabaseBrowserClient();

  // Check current session
  supabase.auth.getSession().then(({ data }: { data: { session: unknown } }) => {
    const next = !!data.session;
    if (next !== cachedLoggedIn) {
      cachedLoggedIn = next;
      notify();
    }
  });

  // Subscribe to auth state changes (login, logout, token refresh)
  supabase.auth.onAuthStateChange((_event: string, session: unknown) => {
    const next = !!session;
    if (next !== cachedLoggedIn) {
      cachedLoggedIn = next;
      notify();
    }
  });
}

/**
 * React hook: is the user currently logged in?
 *
 * - Returns `false` during SSR (hydration-safe).
 * - After hydration, checks the Supabase session from cookies.
 * - Reactively updates on login/logout/token refresh events.
 *
 * Use for UI hints ONLY (e.g. showing Account vs Login link in the header).
 * Never use this as a security gate — that's what server-side guards are for.
 */
export function useIsLoggedIn(): boolean {
  if (typeof window !== "undefined") ensureInit();
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Imperatively mark the user as logged in/out.
 * Useful after a server function login/logout call completes
 * before the auth state change event fires.
 */
export function setLoggedInHint(value: boolean): void {
  if (value !== cachedLoggedIn) {
    cachedLoggedIn = value;
    notify();
  }
}
