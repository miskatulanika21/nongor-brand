import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { loadAdminSettings, saveSettings } from "@/lib/settings.api";
import type { AdminSettings } from "@/lib/settings.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Info } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({ meta: [{ title: "Settings · Nongorr Admin" }] }),
  loader: () => loadAdminSettings(),
  component: Settings,
});

function Settings() {
  const res = Route.useLoaderData();
  if (!res.success || !res.settings) {
    return (
      <div className="max-w-3xl">
        <AdminHeader title="Settings" description="Configure your store." />
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-muted-foreground">
          {res.success ? "Settings are unavailable right now." : res.error}
        </div>
      </div>
    );
  }
  return <SettingsForm initial={res.settings} />;
}

/** Form mirror of AdminSettings: text/number fields as strings, the toggle as a boolean. */
type FormState = Record<Exclude<keyof FormFields, "announcement_enabled">, string> & {
  announcement_enabled: boolean;
};
type FormFields = {
  store_name: string;
  tagline: string;
  announcement_enabled: boolean;
  announcement_text: string;
  announcement_link: string;
  free_delivery_threshold: string;
  delivery_fee_dhaka: string;
  delivery_fee_major: string;
  delivery_fee_outside: string;
  contact_email: string;
  contact_phone: string;
  whatsapp: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  return_window_days: string;
  order_hold_hours: string;
  bkash_number: string;
  nagad_number: string;
  payment_instructions: string;
};

const txt = (v: string | null | undefined) => v ?? "";
const numTxt = (v: number | null | undefined) => (v == null ? "" : String(v));

function toFormState(s: AdminSettings): FormState {
  return {
    store_name: txt(s.store_name),
    tagline: txt(s.tagline),
    announcement_enabled: s.announcement_enabled,
    announcement_text: txt(s.announcement_text),
    announcement_link: txt(s.announcement_link),
    free_delivery_threshold: numTxt(s.free_delivery_threshold),
    delivery_fee_dhaka: numTxt(s.delivery_fee_dhaka),
    delivery_fee_major: numTxt(s.delivery_fee_major),
    delivery_fee_outside: numTxt(s.delivery_fee_outside),
    contact_email: txt(s.contact_email),
    contact_phone: txt(s.contact_phone),
    whatsapp: txt(s.whatsapp),
    instagram: txt(s.instagram),
    facebook: txt(s.facebook),
    tiktok: txt(s.tiktok),
    return_window_days: numTxt(s.return_window_days),
    order_hold_hours: numTxt(s.order_hold_hours),
    bkash_number: txt(s.bkash_number),
    nagad_number: txt(s.nagad_number),
    payment_instructions: txt(s.payment_instructions),
  };
}

function SettingsForm({ initial }: { initial: AdminSettings }) {
  const router = useRouter();
  const [s, setS] = useState<FormState>(() => toFormState(initial));
  const [saving, setSaving] = useState<string | null>(null);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  async function save(section: string, patch: Record<string, unknown>) {
    setSaving(section);
    try {
      const result = await saveSettings({ data: patch });
      if (result.success) {
        toast.success(`${section} saved.`);
        router.invalidate();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Could not save settings. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

  return (
    <div className="max-w-3xl">
      <AdminHeader
        title="Settings"
        description="Configure your store. Changes are saved to the database and audited."
      />
      <div className="space-y-6">
        {/* Store info */}
        <Section
          title="Store Info"
          busy={saving === "Store info"}
          onSave={() => save("Store info", { store_name: s.store_name, tagline: s.tagline })}
        >
          <Field label="Store name" value={s.store_name} onChange={(v) => set("store_name", v)} />
          <Field label="Tagline" value={s.tagline} onChange={(v) => set("tagline", v)} />
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Logo &amp; favicon uploads arrive with
            the media library.
          </p>
        </Section>

        {/* Payment (admin-only fields) */}
        <Section
          title="Payment"
          busy={saving === "Payment"}
          onSave={() =>
            save("Payment", {
              bkash_number: s.bkash_number,
              nagad_number: s.nagad_number,
              payment_instructions: s.payment_instructions,
            })
          }
        >
          <Field
            label="bKash number"
            value={s.bkash_number}
            onChange={(v) => set("bkash_number", v)}
            placeholder="01XXXXXXXXX"
          />
          <Field
            label="Nagad number (optional)"
            value={s.nagad_number}
            onChange={(v) => set("nagad_number", v)}
            placeholder="01XXXXXXXXX"
          />
          <div className="space-y-1.5">
            <Label>Payment instruction text</Label>
            <Textarea
              value={s.payment_instructions}
              onChange={(e) => set("payment_instructions", e.target.value)}
              rows={3}
            />
          </div>
        </Section>

        {/* Delivery */}
        <Section
          title="Delivery"
          busy={saving === "Delivery"}
          onSave={() =>
            save("Delivery", {
              delivery_fee_dhaka: num(s.delivery_fee_dhaka),
              delivery_fee_major: num(s.delivery_fee_major),
              delivery_fee_outside: num(s.delivery_fee_outside),
              free_delivery_threshold: num(s.free_delivery_threshold),
            })
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Inside Dhaka charge (৳)"
              type="number"
              value={s.delivery_fee_dhaka}
              onChange={(v) => set("delivery_fee_dhaka", v)}
            />
            <Field
              label="Major city charge (৳)"
              type="number"
              value={s.delivery_fee_major}
              onChange={(v) => set("delivery_fee_major", v)}
            />
            <Field
              label="Outside Dhaka charge (৳)"
              type="number"
              value={s.delivery_fee_outside}
              onChange={(v) => set("delivery_fee_outside", v)}
            />
            <Field
              label="Free delivery threshold (৳)"
              type="number"
              value={s.free_delivery_threshold}
              onChange={(v) => set("free_delivery_threshold", v)}
            />
          </div>
        </Section>

        {/* Contact */}
        <Section
          title="Contact"
          busy={saving === "Contact"}
          onSave={() =>
            save("Contact", {
              whatsapp: s.whatsapp,
              instagram: s.instagram,
              facebook: s.facebook,
              tiktok: s.tiktok,
              contact_email: s.contact_email,
              contact_phone: s.contact_phone,
            })
          }
        >
          <Field label="WhatsApp" value={s.whatsapp} onChange={(v) => set("whatsapp", v)} />
          <Field label="Instagram" value={s.instagram} onChange={(v) => set("instagram", v)} />
          <Field label="Facebook" value={s.facebook} onChange={(v) => set("facebook", v)} />
          <Field
            label="TikTok (optional)"
            value={s.tiktok}
            onChange={(v) => set("tiktok", v)}
            placeholder="https://tiktok.com/@nongorr"
          />
          <Field
            label="Support email"
            type="email"
            value={s.contact_email}
            onChange={(v) => set("contact_email", v)}
          />
          <Field
            label="Support phone"
            value={s.contact_phone}
            onChange={(v) => set("contact_phone", v)}
          />
        </Section>

        {/* Announcement bar */}
        <Section
          title="Announcement bar"
          busy={saving === "Announcement"}
          onSave={() =>
            save("Announcement", {
              announcement_text: s.announcement_text,
              announcement_link: s.announcement_link,
              announcement_enabled: s.announcement_enabled,
            })
          }
        >
          <div className="space-y-1.5">
            <Label>Announcement text</Label>
            <Input
              value={s.announcement_text}
              onChange={(e) => set("announcement_text", e.target.value)}
              placeholder="🎉 Eid Collection is live — Free delivery over ৳3000!"
            />
          </div>
          <Field
            label="Link (optional)"
            value={s.announcement_link}
            onChange={(v) => set("announcement_link", v)}
            placeholder="/shop?filter=new-arrivals"
          />
          <label className="flex items-center justify-between rounded-lg border border-border p-3">
            <span className="text-sm text-foreground">Show announcement bar</span>
            <Switch
              checked={s.announcement_enabled}
              onCheckedChange={(v) => set("announcement_enabled", v)}
            />
          </label>
        </Section>

        {/* Policies */}
        <Section
          title="Policies"
          busy={saving === "Policies"}
          onSave={() =>
            save("Policies", {
              return_window_days: num(s.return_window_days),
              order_hold_hours: num(s.order_hold_hours),
            })
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Return window (days)"
              type="number"
              value={s.return_window_days}
              onChange={(v) => set("return_window_days", v)}
            />
            <Field
              label="Order hold (hours)"
              type="number"
              value={s.order_hold_hours}
              onChange={(v) => set("order_hold_hours", v)}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  onSave,
  busy,
}: {
  title: string;
  children: React.ReactNode;
  onSave: () => void;
  busy?: boolean;
}) {
  return (
    <form
      className="space-y-4 rounded-xl border border-border bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <h2 className="font-display text-xl text-foreground">{title}</h2>
      {children}
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : `Save ${title.toLowerCase()}`}
      </Button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
