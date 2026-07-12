import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { updatePassword } from "@/lib/auth.api";
import {
  deleteAccount,
  getConnectedIdentities,
  signOutEverywhere,
  startIdentityLink,
  unlinkIdentity,
} from "@/lib/account-security.api";
import type { ConnectedIdentitiesResult } from "@/lib/server/account-security.server";
import { useConfirm } from "@/components/ui/confirm-dialog";
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

const PROVIDER_LABEL: Record<string, string> = { google: "Google", facebook: "Facebook" };

function SecurityPage() {
  const [identities, setIdentities] = useState<ConnectedIdentitiesResult | null>(null);
  const [loadingIdentities, setLoadingIdentities] = useState(true);

  const refreshIdentities = useCallback(async () => {
    try {
      const res = await getConnectedIdentities();
      if (res.success) setIdentities(res.data);
    } finally {
      setLoadingIdentities(false);
    }
  }, []);

  useEffect(() => {
    void refreshIdentities();
  }, [refreshIdentities]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl text-foreground">Security</h2>
        <p className="text-sm text-muted-foreground">
          Manage your password and account security settings.
        </p>
      </div>

      <ChangePasswordCard />

      <ConnectedLoginMethodsCard
        data={identities}
        loading={loadingIdentities}
        onChanged={refreshIdentities}
      />

      <ActiveSessionsCard />

      <DeleteAccountCard hasPassword={identities?.hasPassword ?? true} />
    </div>
  );
}

// ---- Connected login methods (real: link / unlink) ----

function ConnectedLoginMethodsCard({
  data,
  loading,
  onChanged,
}: {
  data: ConnectedIdentitiesResult | null;
  loading: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const configured = data?.configured ?? [];

  async function onConnect(provider: "google" | "facebook") {
    setBusy(provider);
    try {
      const res = await startIdentityLink({ data: { provider } });
      if (res.success && res.url) {
        window.location.href = res.url;
        return;
      }
      toast.error(res.success ? "Couldn't start linking." : res.error);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function onDisconnect(identityId: string, label: string) {
    setBusy(identityId);
    try {
      const res = await unlinkIdentity({ data: { identityId } });
      if (res.success) {
        toast.success(`${label} disconnected.`);
        await onChanged();
      } else {
        toast.error(res.error);
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card icon={<Link2 className="h-5 w-5" />} title="Connected login methods">
      {loading ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : configured.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Social sign-in isn't enabled for this store yet.
        </p>
      ) : (
        <div className="space-y-3">
          {configured.map((provider) => {
            const label = PROVIDER_LABEL[provider] ?? provider;
            const linked = (data?.identities ?? []).find((i) => i.provider === provider);
            const isBusy = busy === provider || (linked && busy === linked.identityId);
            return (
              <div
                key={provider}
                className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {linked ? (linked.email ?? "Connected") : "Not connected"}
                  </p>
                </div>
                {linked ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!isBusy}
                    onClick={() => onDisconnect(linked.identityId, label)}
                  >
                    {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disconnect"}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!isBusy}
                    onClick={() => onConnect(provider)}
                  >
                    {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ---- Active sessions (real: global sign-out) ----

function ActiveSessionsCard() {
  const [loading, setLoading] = useState(false);

  async function onSignOutEverywhere() {
    setLoading(true);
    try {
      const res = await signOutEverywhere();
      if (res.success) {
        toast.success("Signed out of all sessions.");
        window.location.assign("/login");
      } else {
        toast.error(res.error);
        setLoading(false);
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <Card icon={<MonitorSmartphone className="h-5 w-5" />} title="Active sessions">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">Current session</p>
          <p className="text-xs text-muted-foreground">You are signed in on this device.</p>
        </div>
        <Badge variant="outline">This device</Badge>
      </div>
      <Button variant="outline" className="mt-4" disabled={loading} onClick={onSignOutEverywhere}>
        {loading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <LogOut className="mr-2 h-4 w-4" />
        )}
        Log out of all sessions
      </Button>
    </Card>
  );
}

// ---- Delete account (real: re-auth + irreversible) ----

function DeleteAccountCard({ hasPassword }: { hasPassword: boolean }) {
  const confirm = useConfirm();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setError(null);
    if (hasPassword && !password.trim()) {
      setError("Enter your current password to delete your account.");
      return;
    }
    const ok = await confirm({
      tone: "danger",
      title: "Delete your account?",
      description:
        "This permanently removes your profile, addresses, measurements and wishlist. Your past orders are kept as records but detached from your account. This cannot be undone.",
      confirmText: "Delete account",
    });
    if (!ok) return;

    setLoading(true);
    try {
      const res = await deleteAccount({
        data: hasPassword ? { currentPassword: password } : {},
      });
      if (res.success) {
        toast.success("Your account has been deleted.");
        window.location.assign("/");
      } else {
        setError(res.error);
        setLoading(false);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
      <div className="flex items-center gap-2 text-destructive">
        <Trash2 className="h-5 w-5" />
        <h3 className="font-display text-lg">Delete account</h3>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Permanently delete your account and personal data. Past orders are kept as records but
        detached from your account. This action cannot be undone.
      </p>
      {hasPassword && (
        <div className="mt-4 max-w-sm space-y-1.5">
          <Label className="text-sm">Current password</Label>
          <Input
            type="password"
            placeholder="Enter your current password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className={cn(error && "border-destructive focus-visible:ring-destructive/30")}
          />
        </div>
      )}
      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}
      <Button variant="destructive" className="mt-4" disabled={loading} onClick={onDelete}>
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting…
          </>
        ) : (
          "Delete account"
        )}
      </Button>
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
