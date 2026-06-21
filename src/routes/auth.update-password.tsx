/**
 * /auth/update-password — Set a new password after the recovery flow.
 *
 * STANDALONE auth route (NOT under the customer-only /account layout) so that
 * staff/admin/owner can complete password recovery too — the previous
 * /account/update-password sat under a customer guard that redirected privileged
 * users to /admin before they could set a password.
 *
 * The user arrives here from /auth/confirm?type=recovery, which verifies the
 * recovery token and establishes a session. beforeLoad confirms a session
 * exists; on success the server returns a ROLE-AWARE destination (customer →
 * /account, staff/admin/owner → /admin), so the post-update redirect is correct
 * for every role.
 */
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { getSessionSummary, updatePassword } from "@/lib/auth.api";
import { passwordUpdateSchema } from "@/lib/validation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, Loader2, CheckCircle2, AlertCircle, KeyRound } from "lucide-react";

export const Route = createFileRoute("/auth/update-password")({
  head: () => ({
    meta: [
      { title: "Set New Password · Nongorr" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  beforeLoad: async () => {
    // A valid recovery session must already exist (established by /auth/confirm).
    // If not (direct navigation / expired/invalid link), bounce to login with a
    // generic notice — never render the form without a session.
    const summary = await getSessionSummary();
    if (!summary.isAuthenticated) {
      throw redirect({ href: "/login?notice=recovery" });
    }
  },
  component: UpdatePasswordPage,
});

function UpdatePasswordPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const result = passwordUpdateSchema.safeParse({ password, confirm });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as string;
        if (!fieldErrors[field]) fieldErrors[field] = issue.message;
      }
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    return true;
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);

    try {
      const result = await updatePassword({ data: { password, confirm, next } });

      if (result.success) {
        setDone(true);
        toast.success("Password updated successfully!");
        // Server-resolved, role-aware destination (customer → /account,
        // staff/admin/owner → /admin). Fall back to /account.
        const target = result.destination ?? "/account";
        setTimeout(() => navigate({ href: target }), 1500);
      } else {
        setErrors({ password: result.error });
      }
    } catch {
      setErrors({ password: "Something went wrong. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-primary via-primary/90 to-[hsl(345_55%_18%)] p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo variant="light" />
        </div>
        <div className="rounded-2xl border border-gold/30 bg-card/95 p-8 shadow-card backdrop-blur">
          <div className="mb-4 flex items-center gap-2 text-primary">
            <KeyRound className="h-5 w-5" />
            <h1 className="font-display text-xl">Set New Password</h1>
          </div>

          {done ? (
            <div className="space-y-4 py-4 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
              <p className="text-sm text-foreground">
                Your password has been updated. Redirecting…
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label className="text-sm">New password</Label>
                <div className="relative">
                  <Input
                    type={show ? "text" : "password"}
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    className={cn(
                      "pr-10",
                      errors.password && "border-destructive focus-visible:ring-destructive/30",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 z-10 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="h-3.5 w-3.5" /> {errors.password}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Confirm password</Label>
                <Input
                  type={show ? "text" : "password"}
                  placeholder="Re-enter password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  className={cn(
                    errors.confirm && "border-destructive focus-visible:ring-destructive/30",
                  )}
                />
                {errors.confirm && (
                  <p className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="h-3.5 w-3.5" /> {errors.confirm}
                  </p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating…
                  </>
                ) : (
                  "Update Password"
                )}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
