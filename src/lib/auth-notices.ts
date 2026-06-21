/**
 * Generic, non-revealing notice messages surfaced after a guard redirect.
 * Isomorphic + tiny. Keep messages generic — never expose role requirements
 * or account existence. (Spec §30.)
 */
import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";

export const AUTH_NOTICES: Record<string, string> = {
  inactive: "This staff account is inactive. Contact the account owner.",
  verify: "We could not verify your account access. Please try again.",
  denied: "You do not have access to that area.",
  permission: "You do not have permission to view that page.",
  recovery: "Your password reset link is invalid or has expired. Please request a new one.",
};

/**
 * Show a one-time toast for a `?notice=` search param on the current route.
 * Safe during SSR (effect runs client-side only).
 */
export function useNoticeToast(): void {
  const search = useRouterState({ select: (s) => s.location.search }) as Record<string, unknown>;
  const shown = useRef(false);

  useEffect(() => {
    if (shown.current) return;
    const code = typeof search.notice === "string" ? search.notice : undefined;
    const message = code ? AUTH_NOTICES[code] : undefined;
    if (message) {
      shown.current = true;
      toast.info(message);
    }
  }, [search]);
}
