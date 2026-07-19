import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { MediaPickerField } from "@/components/admin/MediaPickerField";
import { loadAdminSettings, saveSettings } from "@/lib/settings.api";
import type { AdminSettings, ManualPaymentMethod } from "@/lib/settings.schema";
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

/**
 * Form mirror of AdminSettings: text/number fields as strings, toggles as
 * booleans, and the enabled manual-method set as an array.
 */
type StringFields = Exclude<
  keyof FormFields,
  "announcement_enabled" | "cod_enabled" | "payment_methods_enabled"
>;
type FormState = Record<StringFields, string> & {
  announcement_enabled: boolean;
  cod_enabled: boolean;
  payment_methods_enabled: ManualPaymentMethod[];
};
type FormFields = {
  store_name: string;
  tagline: string;
  logo_url: string;
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
  cod_enabled: boolean;
  payment_methods_enabled: ManualPaymentMethod[];
  bkash_number: string;
  nagad_number: string;
  payment_instructions: string;
};

/** Manual (non-COD) methods in canonical display order. */
const MANUAL_METHOD_OPTIONS: { value: ManualPaymentMethod; label: string }[] = [
  { value: "bkash", label: "bKash" },
  { value: "nagad", label: "Nagad" },
];

const txt = (v: string | null | undefined) => v ?? "";
const numTxt = (v: number | null | undefined) => (v == null ? "" : String(v));

function toFormState(s: AdminSettings): FormState {
  return {
    store_name: txt(s.store_name),
    tagline: txt(s.tagline),
    logo_url: txt(s.logo_url),
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
    cod_enabled: s.cod_enabled,
    payment_methods_enabled: s.payment_methods_enabled,
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

  /** Add/remove a manual method, keeping the canonical display order. */
  function toggleMethod(m: ManualPaymentMethod, on: boolean) {
    setS((prev) => {
      const enabled = new Set(prev.payment_methods_enabled);
      if (on) enabled.add(m);
      else enabled.delete(m);
      return {
        ...prev,
        payment_methods_enabled: MANUAL_METHOD_OPTIONS.map((o) => o.value).filter((v) =>
          enabled.has(v),
        ),
      };
    });
  }

  const noMethodEnabled = !s.cod_enabled && s.payment_methods_enabled.length === 0;

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
          onSave={() =>
            save("Store info", {
              store_name: s.store_name,
              tagline: s.tagline,
              logo_url: s.logo_url,
            })
          }
        >
          <Field label="Store name" value={s.store_name} onChange={(v) => set("store_name", v)} />
          <Field label="Tagline" value={s.tagline} onChange={(v) => set("tagline", v)} />
          <div className="space-y-1.5">
            <Label>Brand logo</Label>
            <MediaPickerField
              value={s.logo_url === "" ? null : s.logo_url}
              onChange={(url) => set("logo_url", url ?? "")}
              previewAlt="Brand logo"
              emptyHint="Using the built-in logo."
            />
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Shown on the About page. The header
              and footer use a fixed lockup and are not affected.
            </p>
          </div>
        </Section>

        {/* Payment methods (which options appear at checkout) */}
        <Section
          title="Payment methods"
          busy={saving === "Payment methods"}
          onSave={() =>
            save("Payment methods", {
              cod_enabled: s.cod_enabled,
              payment_methods_enabled: s.payment_methods_enabled,
            })
          }
        >
          <p className="text-xs text-muted-foreground">
            Choose which options customers see at checkout. Manual methods (bKash / Nagad) ask the
            customer to send money and submit a TrxID; Cash on Delivery is confirmed by your team.
          </p>
          <label className="flex items-center justify-between rounded-lg border border-border p-3">
            <span className="text-sm text-foreground">Cash on Delivery (COD)</span>
            <Switch
              checked={s.cod_enabled}
              onCheckedChange={(v) => set("cod_enabled", v)}
              aria-label="Enable Cash on Delivery"
            />
          </label>
          {MANUAL_METHOD_OPTIONS.map((o) => (
            <label
              key={o.value}
              className="flex items-center justify-between rounded-lg border border-border p-3"
            >
              <span className="text-sm text-foreground">{o.label} (manual)</span>
              <Switch
                checked={s.payment_methods_enabled.includes(o.value)}
                onCheckedChange={(v) => toggleMethod(o.value, v)}
                aria-label={`Enable ${o.label}`}
              />
            </label>
          ))}
          {noMethodEnabled && (
            <p className="flex items-start gap-2 text-xs text-destructive">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> No payment method is enabled —
              customers won&apos;t be able to check out until you turn one on.
            </p>
          )}
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
