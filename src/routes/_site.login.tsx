import { createFileRoute, Link, useNavigate, redirect, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import logoTransparent from "@/assets/nongorr-logo-transparent.webp";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setLoggedInHint } from "@/lib/auth-state";
import {
  loginWithEmail,
  registerWithEmail,
  requestPasswordReset,
  resolveAuthenticatedDestination,
  startOAuth,
} from "@/lib/auth.api";
import { loginSchema, registerSchema, emailSchema } from "@/lib/validation";
import { isOAuthProviderEnabled, type OAuthProvider } from "@/lib/auth-config";
import { Eye, EyeOff, Loader2, ShieldCheck, CheckCircle2, AlertCircle } from "lucide-react";

/** Generic, non-revealing notices surfaced after a guard redirect. */
const NOTICES: Record<string, string> = {
  inactive: "This staff account is inactive. Contact the account owner.",
  verify: "We could not verify your account access. Please try again.",
  denied: "You do not have access to that area.",
};

export const Route = createFileRoute("/_site/login")({
  validateSearch: (search: Record<string, unknown>): { next?: string; notice?: string } => ({
    next: typeof search.next === "string" ? search.next : undefined,
    notice: typeof search.notice === "string" ? search.notice : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign In or Create Account · Nongorr" },
      {
        name: "description",
        content:
          "Sign in or create your Nongorr account to track orders, save your wishlist, manage custom-size details, and enjoy a more personal shopping experience.",
      },
      { property: "og:title", content: "Sign In or Create Account · Nongorr" },
      {
        property: "og:description",
        content: "Enter your premium Nongorr boutique account space.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: "/login" }],
  }),
  beforeLoad: async ({ search }) => {
    // Redirect already-authenticated users to their server-resolved destination.
    const result = await resolveAuthenticatedDestination({
      data: { next: (search as { next?: string }).next },
    });
    if (result.authenticated && result.destination) {
      throw redirect({ to: result.destination });
    }
  },
  component: Auth,
});

function isEmail(v: string) {
  return emailSchema.safeParse(v).success;
}

function Auth() {
  const [tab, setTab] = useState("login");
  const [forgotOpen, setForgotOpen] = useState(false);
  const search = useSearch({ from: "/_site/login" });
  const loginNext = search.next;
  const notice = search.notice ? NOTICES[search.notice] : undefined;

  return (
    <div className="nongorr-login-illustrated-page relative isolate overflow-hidden">
      <div className="mx-auto grid max-w-7xl items-start gap-0 lg:grid-cols-12">
        <aside
          aria-hidden="true"
          className="pointer-events-none relative hidden lg:col-span-5 lg:block"
        >
          <img
            src={logoTransparent}
            alt=""
            width={160}
            height={160}
            className="absolute left-1/2 top-8 w-[120px] -translate-x-1/2 select-none xl:top-10 xl:w-[150px]"
            loading="eager"
            decoding="async"
          />
        </aside>

        <main className="relative flex min-h-[calc(100svh-var(--auth-header-height,4.25rem))] flex-col items-center justify-center px-4 py-5 sm:px-8 sm:py-6 lg:col-span-7 lg:py-8">
          <div className="relative w-full max-w-md animate-scale-in">
            <div className="rounded-3xl border border-gold/40 bg-card p-6 shadow-card sm:p-7">
              <div className="mb-4 flex items-center justify-center gap-2 text-xs font-medium text-success">
                <ShieldCheck className="h-4 w-4" />
                <span className="uppercase tracking-[0.18em]">Secure account area</span>
              </div>

              {notice && (
                <div
                  role="status"
                  className="mb-4 flex items-start gap-2 rounded-xl border border-gold/40 bg-gold/5 px-3 py-2.5 text-sm text-foreground"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                  <span>{notice}</span>
                </div>
              )}

              <Tabs value={tab} onValueChange={setTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="login">Login</TabsTrigger>
                  <TabsTrigger value="register">Create Account</TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="pt-5">
                  <LoginForm onForgot={() => setForgotOpen(true)} next={loginNext} />
                </TabsContent>
                <TabsContent value="register" className="pt-5">
                  <RegisterForm onDone={() => setTab("login")} />
                </TabsContent>
              </Tabs>

              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  or
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <OAuthButton provider="google" next={loginNext} />
                <OAuthButton provider="facebook" next={loginNext} />
              </div>
            </div>

            {/* guest checkout */}
            <div className="mt-4 rounded-2xl border border-border bg-secondary/40 p-4 text-center">
              <p className="text-sm text-muted-foreground">Shopping for the first time?</p>
              <Button variant="link" asChild className="text-primary">
                <Link to="/shop">Continue as Guest →</Link>
              </Button>
            </div>
          </div>
        </main>
      </div>

      <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} />
    </div>
  );
}

/* ---------------- OAuth button ---------------- */
function OAuthButton({ provider, next }: { provider: OAuthProvider; next?: string }) {
  const enabled = isOAuthProviderEnabled(provider);
  const [loading, setLoading] = useState(false);
  const label = provider === "google" ? "Google" : "Facebook";
  const Icon = provider === "google" ? GoogleIcon : FacebookIcon;

  async function onClick() {
    if (!enabled || loading) return;
    setLoading(true);
    try {
      const result = await startOAuth({ data: { provider, next } });
      if (result.success && result.url) {
        window.location.href = result.url;
        return;
      }
      toast.error(result.success ? "Unable to start sign-in." : result.error);
      setLoading(false);
    } catch {
      toast.error("Unable to start sign-in. Please try again.");
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={!enabled || loading}
      aria-disabled={!enabled || loading}
      aria-label={
        enabled ? `Sign in with ${label}` : `Sign in with ${label} — currently unavailable`
      }
      onClick={onClick}
      className={cn("gap-2", !enabled && "opacity-60")}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon />} {label}
      {!enabled && <span className="text-xs text-muted-foreground">· Unavailable</span>}
    </Button>
  );
}

/* ---------------- Login ---------------- */
function LoginForm({ onForgot, next }: { onForgot: () => void; next?: string }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    const result = loginSchema.safeParse({ email: email.trim(), password });
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0] as string;
        if (!e[field]) e[field] = issue.message;
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);

    try {
      const result = await loginWithEmail({
        data: { email: email.trim(), password, next },
      });

      if (!result.success) {
        setErrors({ password: result.error });
        toast.error(result.error);
        setLoading(false);
        return;
      }

      if (result.adminDenied) {
        toast.info("You do not have access to that area.");
      } else {
        toast.success("Welcome back to Nongorr");
      }

      setLoggedInHint(true);
      navigate({ to: result.destination });
    } catch {
      setErrors({ password: "Something went wrong. Please try again." });
      setLoading(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
      <Field label="Email address" error={errors.email}>
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!errors.email}
          className={inputCls(errors.email)}
        />
      </Field>

      <Field label="Password" error={errors.password}>
        <div className="relative">
          <Input
            autoComplete="current-password"
            type={show ? "text" : "password"}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password}
            className={cn(inputCls(errors.password), "pr-10")}
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
      </Field>

      {/* Remember Me was removed: Supabase SSR uses a single secure HttpOnly
          cookie lifetime, so a per-login "remember" toggle could not change
          session duration without insecure client-side token handling. The
          session persists securely until logout or expiry. */}
      <div className="flex items-center justify-end">
        <button type="button" onClick={onForgot} className="text-sm text-primary hover:underline">
          Forgot password?
        </button>
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…
          </>
        ) : (
          "Sign In"
        )}
      </Button>
    </form>
  );
}

/* ---------------- Register ---------------- */
function RegisterForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "", confirm: "" });
  const [agree, setAgree] = useState(false);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function validate() {
    const e: Record<string, string> = {};
    const result = registerSchema.safeParse({
      name: form.name.trim(),
      phone: form.phone,
      email: form.email.trim(),
      password: form.password,
      confirm: form.confirm,
    });
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0] as string;
        if (!e[field]) e[field] = issue.message;
      }
    }
    if (!agree) e.agree = "Please accept the Terms & Privacy Policy.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);

    try {
      const result = await registerWithEmail({
        data: {
          name: form.name.trim(),
          phone: form.phone,
          email: form.email.trim().toLowerCase(),
          password: form.password,
          confirm: form.confirm,
        },
      });

      if (!result.success) {
        setErrors({ email: result.error });
        toast.error(result.error);
        setLoading(false);
        return;
      }

      toast.success(result.message || "Account created! Check your email to confirm.");
      onDone();
    } catch {
      setErrors({ email: "Something went wrong. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
      <Field label="Full name" error={errors.name}>
        <Input
          placeholder="Your name"
          autoComplete="name"
          value={form.name}
          onChange={set("name")}
          className={inputCls(errors.name)}
        />
      </Field>
      <Field label="Phone number" error={errors.phone}>
        <Input
          inputMode="tel"
          autoComplete="tel"
          placeholder="01XXXXXXXXX"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          className={inputCls(errors.phone)}
        />
      </Field>
      <Field label="Email address" error={errors.email}>
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@email.com"
          value={form.email}
          onChange={set("email")}
          className={inputCls(errors.email)}
        />
      </Field>
      <Field label="Password" error={errors.password}>
        <div className="relative">
          <Input
            type={show ? "text" : "password"}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={form.password}
            onChange={set("password")}
            className={cn(inputCls(errors.password), "pr-10")}
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
      </Field>
      <Field label="Confirm password" error={errors.confirm}>
        <Input
          type={show ? "text" : "password"}
          autoComplete="new-password"
          placeholder="Re-enter password"
          value={form.confirm}
          onChange={set("confirm")}
          className={inputCls(errors.confirm)}
        />
      </Field>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-muted-foreground">
        <Checkbox checked={agree} onCheckedChange={(v) => setAgree(!!v)} className="mt-0.5" />
        <span>
          I agree to Nongorr's{" "}
          <Link to="/terms" className="text-primary hover:underline">
            Terms
          </Link>{" "}
          &{" "}
          <Link to="/privacy-policy" className="text-primary hover:underline">
            Privacy Policy
          </Link>
        </span>
      </label>
      {errors.agree && <ErrorMsg msg={errors.agree} />}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating account…
          </>
        ) : (
          "Create Account"
        )}
      </Button>
    </form>
  );
}

/* ---------------- Forgot password ---------------- */
function ForgotPasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setValue("");
    setSent(false);
    setError("");
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const v = value.trim();
    if (!v || !isEmail(v)) {
      setError("Enter a valid email address.");
      return;
    }
    setError("");
    setLoading(true);

    try {
      await requestPasswordReset({ data: { email: v } });
      setSent(true);
    } catch {
      setSent(true); // Always show success — never reveal whether the email exists.
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setTimeout(reset, 200);
      }}
    >
      <DialogContent className="rounded-3xl border-gold/40 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Reset your password</DialogTitle>
          <DialogDescription>
            Enter your email address and we'll send reset instructions.
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="space-y-4 py-2 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
            <p className="text-sm text-foreground">
              If an account exists for that email, password reset instructions have been sent.
            </p>
            <Button variant="link" onClick={() => onOpenChange(false)} className="text-primary">
              ← Back to login
            </Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            <Field label="Email address" error={error}>
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@email.com"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={inputCls(error)}
              />
            </Field>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…
                </>
              ) : (
                "Send Reset Link"
              )}
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={() => onOpenChange(false)}
              className="w-full text-muted-foreground"
            >
              ← Back to login
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- helpers ---------------- */
function inputCls(error?: string) {
  return cn(
    "focus-visible:ring-gold/50 focus-visible:border-gold",
    error &&
      "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30",
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm text-foreground">{label}</Label>
      {children}
      {error && <ErrorMsg msg={error} />}
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-destructive">
      <AlertCircle className="h-3.5 w-3.5" /> {msg}
    </p>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#1877F2]" aria-hidden>
      <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.69.24 2.69.24v2.97h-1.52c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z" />
    </svg>
  );
}
