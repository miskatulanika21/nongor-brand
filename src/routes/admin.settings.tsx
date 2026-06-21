import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { BRAND, paymentConfigured } from "@/lib/brand";
import { DELIVERY_ZONES, FREE_DELIVERY_THRESHOLD } from "@/lib/checkout-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Upload, ImageIcon, Info } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/settings")({ component: Settings });

// TODO: persist all store settings via backend; secrets like payment numbers should be server-managed.

const LOCAL_ONLY_NOTE = "Local UI preview only — changes reset after refresh.";

function Settings() {
  return (
    <div className="max-w-3xl">
      <AdminHeader
        title="Settings"
        description="Configure your store. Changes here are mock-only."
      />
      <div className="mb-5 flex items-start gap-2 rounded-lg border border-gold/40 bg-gold/5 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
        <span>{LOCAL_ONLY_NOTE} No values are saved to a server in this preview.</span>
      </div>
      <div className="space-y-6">
        <StoreInfo />
        <Payment />
        <Delivery />
        <Contact />
        <Announcement />
        <Policies />
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  onSave,
}: {
  title: string;
  children: React.ReactNode;
  onSave: () => void;
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
      <Button type="submit">Save {title.toLowerCase()}</Button>
    </form>
  );
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input {...props} />
    </div>
  );
}

function ImagePreview({ label }: { label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border p-3 hover:border-primary">
        <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-md bg-secondary">
          {url ? (
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Upload className="h-4 w-4" /> Upload {label.toLowerCase()}
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setUrl(URL.createObjectURL(f));
          }}
        />
      </label>
    </div>
  );
}

function StoreInfo() {
  return (
    <Section title="Store Info" onSave={() => toast.success("Store info updated (preview only)")}>
      <Field label="Store name" defaultValue={BRAND.name} />
      <Field label="Tagline" defaultValue={BRAND.tagline} />
      <div className="grid gap-4 sm:grid-cols-2">
        <ImagePreview label="Logo" />
        <ImagePreview label="Favicon" />
      </div>
    </Section>
  );
}

function Payment() {
  return (
    <Section
      title="Payment"
      onSave={() => toast.success("Payment settings updated (preview only)")}
    >
      {!paymentConfigured && (
        <p className="rounded-lg border border-gold/40 bg-gold/5 p-3 text-xs text-muted-foreground">
          The current bKash number is a placeholder. It is not shown to customers as an active
          payment number until a real number is configured.
        </p>
      )}
      <Field
        label="bKash number"
        defaultValue={paymentConfigured ? BRAND.bkashNumber : ""}
        placeholder="01XXXXXXXXX"
      />
      <Field label="Nagad number (optional)" placeholder="01XXXXXXXXX" />
      <div className="space-y-1.5">
        <Label>Payment instruction text</Label>
        <Textarea
          defaultValue={
            paymentConfigured
              ? `Send Money to ${BRAND.bkashNumber} (Personal). Then submit the TrxID and sender number to confirm your order.`
              : "Send Money to your configured bKash number (Personal). Then submit the TrxID and sender number to confirm the order."
          }
          rows={3}
        />
      </div>
    </Section>
  );
}

function Delivery() {
  const dhaka = DELIVERY_ZONES.find((z) => z.value === "dhaka")?.fee ?? 0;
  const major = DELIVERY_ZONES.find((z) => z.value === "major")?.fee ?? 0;
  const outside = DELIVERY_ZONES.find((z) => z.value === "outside")?.fee ?? 0;
  return (
    <Section
      title="Delivery"
      onSave={() => toast.success("Delivery settings updated (preview only)")}
    >
      <p className="text-xs text-muted-foreground">
        Defaults shown from shared delivery configuration.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Inside Dhaka charge (৳)" type="number" defaultValue={dhaka} />
        <Field label="Major city charge (৳)" type="number" defaultValue={major} />
        <Field label="Outside Dhaka charge (৳)" type="number" defaultValue={outside} />
        <Field
          label="Free delivery threshold (৳)"
          type="number"
          defaultValue={FREE_DELIVERY_THRESHOLD}
        />
      </div>
    </Section>
  );
}

function Contact() {
  return (
    <Section
      title="Contact"
      onSave={() => toast.success("Contact settings updated (preview only)")}
    >
      <Field label="WhatsApp" defaultValue={BRAND.whatsapp} />
      <Field label="Instagram" defaultValue={BRAND.instagram} />
      <Field label="Facebook" defaultValue={BRAND.facebook} />
      <Field label="TikTok (optional)" placeholder="https://tiktok.com/@nongorr" />
      <Field label="Support email" type="email" defaultValue={BRAND.email} />
    </Section>
  );
}

function Announcement() {
  const [show, setShow] = useState(true);
  return (
    <Section
      title="Announcement bar"
      onSave={() => toast.success("Announcement updated (preview only)")}
    >
      <div className="space-y-1.5">
        <Label>Announcement text</Label>
        <Input defaultValue="🎉 Eid Collection is live — Free delivery over ৳3000!" />
      </div>
      <label className="flex items-center justify-between rounded-lg border border-border p-3">
        <span className="text-sm text-foreground">Show announcement bar</span>
        <Switch checked={show} onCheckedChange={setShow} />
      </label>
    </Section>
  );
}

function Policies() {
  return (
    <Section
      title="Policies"
      onSave={() => toast.success("Policy settings updated (preview only)")}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Return window (days)" type="number" defaultValue={7} />
        <Field label="Order hold (hours)" type="number" defaultValue={24} />
      </div>
    </Section>
  );
}
