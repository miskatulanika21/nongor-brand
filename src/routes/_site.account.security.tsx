import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { updatePassword } from "@/lib/auth.api";
import { passwordUpdateSchema } from "@/lib/validation";
import {
  KeyRound,
  Link2,
  MonitorSmartphone,
  LogOut,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

export const Route = createFileRoute("/_site/account/security")({
  component: SecurityPage,
});

function SecurityPage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl text-foreground">Security</h2>
        <p className="text-sm text-muted-foreground">
          Manage your password and account security settings.
        </p>
      </div>

      {/* Change password — functional */}
      <ChangePasswordCard />

      {/* Connected login methods — future feature */}
      <Card icon={<Link2 className="h-5 w-5" />} title="Connected login methods">
        <div className="space-y-3">
          {["Google", "Facebook"].map((p) => (
            <div
              key={p}
              className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium text-foreground">{p}</p>
                <p className="text-xs text-muted-foreground">Not connected</p>
              </div>
              <Button variant="outline" size="sm" disabled aria-disabled="true">
                Coming soon
              </Button>
            </div>
          ))}
        </div>
      </Card>

      {/* Active sessions */}
      <Card icon={<MonitorSmartphone className="h-5 w-5" />} title="Active sessions">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
          <div className="min-w-0">
            <p className="font-medium text-foreground">Current session</p>
            <p className="text-xs text-muted-foreground">You are signed in on this device.</p>
          </div>
          <Badge variant="outline">This device</Badge>
        </div>
        <Button variant="outline" className="mt-4" disabled aria-disabled="true">
          <LogOut className="mr-2 h-4 w-4" /> Log out of all sessions
        </Button>
      </Card>

      {/* Delete account */}
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
        <div className="flex items-center gap-2 text-destructive">
          <Trash2 className="h-5 w-5" />
          <h3 className="font-display text-lg">Delete account</h3>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Permanently delete your account and all associated data. This action cannot be undone.
        </p>
        <Button variant="destructive" className="mt-4" disabled aria-disabled="true">
          Delete account
        </Button>
      </div>
    </div>
  );
}

// ---- Change Password Card (functional) ----

function ChangePasswordCard() {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  function validate(): boolean {
    const fieldErrors: Record<string, string> = {};
    if (!current.trim()) fieldErrors.current = "Enter your current password.";
    const result = passwordUpdateSchema.safeParse({ password, confirm });
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0] as string;
        if (!fieldErrors[field]) fieldErrors[field] = issue.message;
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
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
      const result = await updatePassword({
        data: { password, confirm, currentPassword: current },
      });

      if (result.success) {
        setDone(true);
        setCurrent("");
        setPassword("");
        setConfirm("");
        toast.success("Password updated successfully!");
        setTimeout(() => setDone(false), 3000);
      } else {
        setErrors({ current: result.error });
      }
    } catch {
      setErrors({ password: "Something went wrong. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card icon={<KeyRound className="h-5 w-5" />} title="Change password">
      {done ? (
        <div className="flex items-center gap-2 py-2 text-success">
          <CheckCircle2 className="h-5 w-5" />
          <p className="text-sm font-medium">Password updated successfully.</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <div className="space-y-1.5">
            <Label className="text-sm">Current password</Label>
            <Input
              type={show ? "text" : "password"}
              placeholder="Enter your current password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              className={cn(
                errors.current && "border-destructive focus-visible:ring-destructive/30",
              )}
            />
            {errors.current && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5" /> {errors.current}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">New password</Label>
            <div className="relative">
              <Input
                type={show ? "text" : "password"}
                placeholder="At least 6 characters"
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
            <Label className="text-sm">Confirm new password</Label>
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

          <Button type="submit" className="mt-1" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating…
              </>
            ) : (
              "Update password"
            )}
          </Button>
        </form>
      )}
    </Card>
  );
}

// ---- Shared Card component ----

function Card({
  icon,
  title,
  note,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-primary">
            {icon}
          </span>
          <h3 className="font-display text-lg text-foreground">{title}</h3>
        </div>
        {note && (
          <Badge variant="outline" className="shrink-0 text-muted-foreground">
            {note}
          </Badge>
        )}
      </div>
      {children}
    </div>
  );
}
