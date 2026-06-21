/**
 * /admin/mfa — TOTP MFA setup & step-up challenge for privileged accounts.
 *
 * Rendered inside the admin shell. The admin guard routes here (when MFA is
 * enforced) for privileged users whose session is not yet aal2. Owner/admin
 * MFA is mandatory; staff may use it voluntarily.
 *
 * Secrets/codes are never logged; all verification happens server-side.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ShieldCheck, Loader2, KeyRound, AlertCircle } from "lucide-react";
import { getMfaState, startMfaEnrollment, verifyMfaEnrollment, challengeMfa } from "@/lib/mfa.api";

export const Route = createFileRoute("/admin/mfa")({
  head: () => ({
    meta: [
      { title: "Two-Factor Security · Nongorr" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: MfaPage,
});

type Phase = "loading" | "active" | "enroll" | "challenge";

function MfaPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const state = await getMfaState();
    if (state.currentLevel === "aal2") {
      setPhase("active");
    } else if (state.enrolledFactors.length > 0) {
      setFactorId(state.enrolledFactors[0].id);
      setPhase("challenge");
    } else {
      setPhase("enroll");
    }
  }

  useEffect(() => {
    refresh().catch(() => setPhase("enroll"));
  }, []);

  async function beginEnroll() {
    setBusy(true);
    setError("");
    try {
      const result = await startMfaEnrollment();
      if (!result.success) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setFactorId(result.factorId);
      setQr(result.qrCode);
      setSecret(result.secret);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(mode: "enroll" | "challenge") {
    if (!factorId || code.trim().length < 6) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fn = mode === "enroll" ? verifyMfaEnrollment : challengeMfa;
      const result = await fn({ data: { factorId, code: code.trim() } });
      if (!result.success) {
        setError(result.error);
        return;
      }
      toast.success("Two-factor verification complete.");
      navigate({ to: "/admin" });
    } finally {
      setBusy(false);
      setCode("");
    }
  }

  if (phase === "loading") {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-6 flex items-center gap-2 text-primary">
        <ShieldCheck className="h-6 w-6" />
        <h1 className="font-display text-2xl text-foreground">Two-Factor Security</h1>
      </div>

      {phase === "active" && (
        <div className="rounded-2xl border border-success/40 bg-success/5 p-6 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-success" />
          <p className="mt-3 text-sm text-foreground">
            Two-factor authentication is active for this session.
          </p>
          <Button className="mt-5" onClick={() => navigate({ to: "/admin" })}>
            Continue to dashboard
          </Button>
        </div>
      )}

      {phase === "enroll" && (
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            Owner and admin accounts require an authenticator app (Google Authenticator, Authy,
            1Password, etc.). Scan the QR code or enter the setup key, then confirm the 6-digit
            code.
          </p>

          {!qr && !secret ? (
            <Button className="mt-5" onClick={beginEnroll} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="mr-2 h-4 w-4" />
              )}
              Begin setup
            </Button>
          ) : (
            <div className="mt-5 space-y-4">
              {qr && <QrDisplay qr={qr} />}
              {secret && (
                <div className="rounded-lg border border-border bg-secondary/40 p-3 text-center">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Setup key
                  </p>
                  <p className="mt-1 break-all font-mono text-sm text-foreground">{secret}</p>
                </div>
              )}
              <CodeForm
                code={code}
                setCode={setCode}
                onSubmit={() => submitCode("enroll")}
                busy={busy}
                error={error}
                cta="Verify & enable"
              />
            </div>
          )}
        </div>
      )}

      {phase === "challenge" && (
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            Enter the current 6-digit code from your authenticator app to continue.
          </p>
          <div className="mt-5">
            <CodeForm
              code={code}
              setCode={setCode}
              onSubmit={() => submitCode("challenge")}
              busy={busy}
              error={error}
              cta="Verify"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function QrDisplay({ qr }: { qr: string }) {
  // Supabase returns either an SVG data URL or raw SVG markup.
  if (qr.startsWith("data:")) {
    return (
      <div className="grid place-items-center">
        <img src={qr} alt="MFA QR code" className="h-44 w-44" />
      </div>
    );
  }
  return (
    <div
      className="mx-auto grid h-44 w-44 place-items-center [&>svg]:h-full [&>svg]:w-full"
      // Trusted, server-generated SVG from Supabase Auth.
      dangerouslySetInnerHTML={{ __html: qr }}
    />
  );
}

function CodeForm({
  code,
  setCode,
  onSubmit,
  busy,
  error,
  cta,
}: {
  code: string;
  setCode: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  error: string;
  cta: string;
}) {
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      noValidate
    >
      <div className="space-y-1.5">
        <Label className="text-sm">Authentication code</Label>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          maxLength={10}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
        />
        {error && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {cta}
      </Button>
    </form>
  );
}
