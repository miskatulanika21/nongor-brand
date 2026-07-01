import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  useAccountUI,
  initials,
  isValidAccountPhone,
  isValidEmail,
  type AccountProfile,
} from "@/lib/account-ui";
import { normalizeBDPhone } from "@/lib/bd-phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Pencil } from "lucide-react";

export const Route = createFileRoute("/_site/account/profile")({
  component: ProfilePage,
});

const today = new Date().toISOString().slice(0, 10);

function ProfilePage() {
  const { hydrated, profile, saveProfile } = useAccountUI();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<AccountProfile>(profile);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Keep the form in sync with the saved profile when not editing.
  useEffect(() => {
    if (!editing) setForm(profile);
  }, [profile, editing]);

  const set = (k: keyof AccountProfile) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Live preview initials (from the in-progress name).
  const previewInitials = useMemo(() => initials(form.name), [form.name]);

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Name is required.";
    if (form.email.trim() && !isValidEmail(form.email)) e.email = "Enter a valid email address.";
    if (form.phone.trim() && !isValidAccountPhone(form.phone))
      e.phone = "Enter a valid Bangladeshi number (01XXXXXXXXX).";
    if (form.birthday) {
      const t = Date.parse(form.birthday);
      if (Number.isFinite(t) && t > Date.now()) e.birthday = "Birthday cannot be in the future.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function onSave() {
    if (!validate()) return;
    const normalized: AccountProfile = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() ? normalizeBDPhone(form.phone) : "",
      birthday: form.birthday,
    };
    const ok = saveProfile(normalized);
    if (ok) {
      toast.success("Profile saved");
      setEditing(false);
    } else {
      toast.error("Could not save in this browser.");
    }
  }

  function onCancel() {
    setForm(profile);
    setErrors({});
    setEditing(false);
  }

  if (!hydrated) {
    return <Skeleton className="h-80 rounded-2xl" />;
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-gradient-hero text-xl font-semibold text-primary-foreground">
          {editing ? previewInitials : initials(profile.name)}
        </div>
        <div className="min-w-0">
          <h2 className="truncate font-display text-xl text-foreground">{profile.name}</h2>
          <p className="truncate text-sm text-muted-foreground">
            {profile.email || "No email saved"}
          </p>
        </div>
        {!editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </Button>
        )}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={errors.name}>
          <Input
            value={form.name}
            disabled={!editing}
            onChange={set("name")}
            className={cn(errors.name && "border-destructive")}
          />
        </Field>
        <Field label="Email (optional)" error={errors.email}>
          <Input
            type="email"
            value={form.email}
            disabled={!editing}
            onChange={set("email")}
            placeholder="you@email.com"
            className={cn(errors.email && "border-destructive")}
          />
        </Field>
        <Field label="Phone (optional)" error={errors.phone}>
          <Input
            inputMode="tel"
            value={form.phone}
            disabled={!editing}
            onChange={set("phone")}
            placeholder="01XXXXXXXXX"
            className={cn(errors.phone && "border-destructive")}
          />
        </Field>
        <Field label="Birthday (optional)" error={errors.birthday}>
          <Input
            type="date"
            max={today}
            value={form.birthday}
            disabled={!editing}
            onChange={set("birthday")}
            className={cn(errors.birthday && "border-destructive")}
          />
        </Field>
      </div>

      {editing && (
        <div className="mt-6 flex gap-3">
          <Button onClick={onSave}>Save</Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Your profile is stored only in this browser. It is not synced or sent to a server.
      </p>
    </div>
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
      <Label className="text-sm">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
