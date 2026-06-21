import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { formatBDT, BRAND, paymentConfigured, PAYMENT_NOTICE } from "@/lib/brand";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EmptyState } from "@/components/states";
import {
  Copy,
  Upload,
  ShoppingBag,
  Check,
  Loader2,
  X,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DISTRICTS,
  DHAKA_AREAS,
  computeShipping,
  suggestDeliveryZoneForDistrict,
  zoneLabel,
} from "@/lib/checkout-ui";

export const Route = createFileRoute("/_site/checkout")({
  head: () => ({
    meta: [
      { title: "Checkout · Nongorr" },
      {
        name: "description",
        content:
          "Complete your Nongorr purchase with manual bKash payment. Enter delivery details and share your TrxID for verification.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: "/checkout" }],
  }),
  component: Checkout,
});

const BD_PHONE = /^01[3-9]\d{8}$/;
function normalizePhone(raw: string) {
  let v = raw.replace(/\D/g, "");
  if (v.startsWith("880")) v = v.slice(3);
  return v;
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

interface ScreenshotPreview {
  file: File;
  url: string;
}

interface Errors {
  [k: string]: string | undefined;
}

const STEPS = ["Delivery", "Payment", "Review", "Submit"] as const;

function Checkout() {
  const {
    cart,
    cartSubtotal,
    clearCart,
    deliveryZone,
    setDeliveryZone,
    appliedCoupon,
    discount,
    deliveryNote,
    setDeliveryNote,
    orderNote,
  } = useStore();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [district, setDistrict] = useState("");
  const [area, setArea] = useState("");
  const [thana, setThana] = useState("");
  const [address, setAddress] = useState("");
  const [trxId, setTrxId] = useState("");
  const [screenshot, setScreenshot] = useState<ScreenshotPreview | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const submitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenshotRef = useRef<ScreenshotPreview | null>(null);
  screenshotRef.current = screenshot;

  const refs: Record<string, React.RefObject<HTMLDivElement | null>> = {
    name: useRef<HTMLDivElement>(null),
    phone: useRef<HTMLDivElement>(null),
    district: useRef<HTMLDivElement>(null),
    locality: useRef<HTMLDivElement>(null),
    address: useRef<HTMLDivElement>(null),
    trxId: useRef<HTMLDivElement>(null),
  };

  // Cleanup timer + object URL on unmount.
  useEffect(() => {
    return () => {
      if (submitTimer.current) clearTimeout(submitTimer.current);
      if (screenshotRef.current) URL.revokeObjectURL(screenshotRef.current.url);
    };
  }, []);

  const shipping = computeShipping(deliveryZone, cartSubtotal);
  const total = Math.max(0, cartSubtotal - discount) + shipping;

  const baseSubtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const customChargesTotal = cart.reduce(
    (sum, item) => sum + (item.customCharge ?? 0) * item.qty,
    0,
  );

  const phoneValue = normalizePhone(phone);
  const phoneValid = BD_PHONE.test(phoneValue);
  const trxValid = trxId.trim().length >= 10;
  const locality = district === "Dhaka" ? area : thana.trim();

  const deliveryComplete = Boolean(
    name.trim() && phoneValid && district && locality && address.trim(),
  );
  const paymentComplete = trxValid;
  const activeStep = !deliveryComplete ? 1 : !paymentComplete ? 2 : submitting ? 4 : 3;

  if (!cart.length) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <EmptyState
          icon={<ShoppingBag className="h-6 w-6" />}
          title="Nothing to checkout"
          action={
            <Button asChild>
              <Link to="/shop">Shop now</Link>
            </Button>
          }
        />
      </div>
    );
  }

  function selectDistrict(v: string) {
    setDistrict(v);
    setArea("");
    setThana("");
    const mapped = suggestDeliveryZoneForDistrict(v);
    if (mapped) setDeliveryZone(mapped);
  }

  function acceptFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setScreenshotError("Unsupported file. Use JPEG, PNG or WebP.");
      return;
    }
    if (file.size > MAX_SIZE) {
      setScreenshotError("File too large. Maximum size is 5 MB.");
      return;
    }
    if (screenshot) URL.revokeObjectURL(screenshot.url);
    setScreenshot({ file, url: URL.createObjectURL(file) });
    setScreenshotError(null);
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    acceptFile(e.target.files?.[0]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeScreenshot() {
    if (screenshot) URL.revokeObjectURL(screenshot.url);
    setScreenshot(null);
    setScreenshotError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function copyNumber() {
    if (!paymentConfigured) {
      toast.info("Payment number is not set up yet — please contact us on WhatsApp.");
      return;
    }
    try {
      await navigator.clipboard.writeText(BRAND.bkashNumber);
      toast.success("Number copied");
    } catch {
      toast.error("Could not copy the number");
    }
  }

  function validate(): Errors {
    const err: Errors = {};
    if (!name.trim()) err.name = "Please enter your name";
    if (!phoneValid) err.phone = "Enter a valid Bangladesh number (e.g. 01712345678)";
    if (!district) err.district = "Please select your district";
    if (district === "Dhaka" ? !area : !thana.trim())
      err.locality =
        district === "Dhaka" ? "Please select your area" : "Please enter thana / upazila";
    if (!address.trim()) err.address = "Please enter your full address";
    if (!trxValid) err.trxId = "TrxID must be at least 10 characters";
    return err;
  }

  function scrollToFirstError(err: Errors) {
    const order = ["name", "phone", "district", "locality", "address", "trxId"];
    const first = order.find((k) => err[k]);
    if (first && refs[first]?.current) {
      refs[first].current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // ignore repeated submits
    const err = validate();
    setErrors(err);
    if (Object.keys(err).length) {
      scrollToFirstError(err);
      return;
    }

    setSubmitting(true);
    submitTimer.current = setTimeout(() => {
      const id = "NGR-" + Math.floor(100000 + Math.random() * 900000);
      const order = {
        id,
        total,
        subtotal: cartSubtotal,
        shipping,
        discount,
        couponCode: appliedCoupon?.code ?? null,
        deliveryZone,
        trxId: trxId.trim().toUpperCase(),
        customerName: name.trim(),
        phone: phoneValue,
        district,
        locality,
        address: address.trim(),
        orderNote: orderNote.trim(),
        deliveryNote: deliveryNote.trim(),
        screenshotAttached: Boolean(screenshot),
        screenshotFileName: screenshot?.file.name,
        status: "Payment Pending",
        date: new Date().toISOString(),
        items: cart.map((i) => ({
          productId: i.productId,
          name: i.name,
          image: i.image,
          qty: i.qty,
          price: i.price,
          size: i.size,
          customSize: i.customSize,
          customCharge: i.customCharge,
        })),
      };

      try {
        localStorage.setItem("nongorr_last_order", JSON.stringify(order));
        const raw = localStorage.getItem("nongorr_orders");
        const list = raw ? JSON.parse(raw) : [];
        list.unshift(order);
        localStorage.setItem("nongorr_orders", JSON.stringify(list));
      } catch {
        // ignore storage failures in mock flow
      }

      clearCart();
      setSubmitting(false);
      navigate({ to: "/order-success" });
    }, 900);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="mb-6 font-display text-4xl text-foreground">Checkout</h1>

      {/* Stepper */}
      <ol className="mb-8 flex items-center gap-2 sm:gap-4">
        {STEPS.map((label, i) => {
          const step = i + 1;
          const state = step < activeStep ? "done" : step === activeStep ? "active" : "todo";
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  "pdp-step-dot",
                  state === "done" && "is-done",
                  state === "active" && "is-active",
                )}
              >
                {state === "done" ? <Check className="h-4 w-4" /> : step}
              </span>
              <span
                className={cn(
                  "hidden text-sm sm:inline",
                  state === "active" ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
            </li>
          );
        })}
      </ol>

      <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[1.5fr_1fr]" noValidate>
        <div className="space-y-8">
          {/* Delivery */}
          <section className="space-y-4 rounded-xl border border-border bg-card p-6">
            <h2 className="font-display text-2xl text-foreground">Delivery Details</h2>

            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              Saved addresses — available after account integration.
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" required error={errors.name} fieldRef={refs.name}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />
              </Field>

              <Field
                label="Phone number"
                required
                error={errors.phone}
                fieldRef={refs.phone}
                hint="Bangladeshi mobile, e.g. 01712345678"
              >
                <div className="relative">
                  <Input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="01XXXXXXXXX"
                    className={cn(
                      phone &&
                        (phoneValid
                          ? "border-green-500 pr-9 focus-visible:ring-green-500"
                          : "border-destructive pr-9"),
                    )}
                  />
                  {phone && phoneValid && (
                    <Check className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-green-500" />
                  )}
                </div>
              </Field>

              <Field label="District" required error={errors.district} fieldRef={refs.district}>
                <Select value={district} onValueChange={selectDistrict}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select district" />
                  </SelectTrigger>
                  <SelectContent>
                    {DISTRICTS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label={district === "Dhaka" ? "Area" : "Thana / Upazila"}
                required
                error={errors.locality}
                fieldRef={refs.locality}
              >
                {district === "Dhaka" ? (
                  <Select value={area} onValueChange={setArea}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select area" />
                    </SelectTrigger>
                    <SelectContent>
                      {DHAKA_AREAS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={thana}
                    onChange={(e) => setThana(e.target.value)}
                    placeholder="e.g. Kotwali"
                    disabled={!district}
                  />
                )}
              </Field>
            </div>
            <Field
              label="Full address"
              required
              error={errors.address}
              fieldRef={refs.address}
              hint="House / flat, road, landmark — helps the courier reach you faster."
            >
              <Textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="House, road, area..."
              />
            </Field>
            <Field label="Delivery note (optional)">
              <Textarea
                value={deliveryNote}
                onChange={(e) => setDeliveryNote(e.target.value.slice(0, 300))}
                placeholder="Any special instruction"
              />
            </Field>
            {district && (
              <p className="text-xs text-muted-foreground">
                Delivery zone:{" "}
                <span className="font-medium text-foreground">{zoneLabel(deliveryZone)}</span> ·{" "}
                {shipping === 0 ? "Free delivery" : formatBDT(shipping)}
              </p>
            )}
          </section>

          {/* Payment */}
          <section className="space-y-4 rounded-xl border border-gold/40 bg-gold/5 p-6">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-2xl text-foreground">Payment — Manual bKash</h2>
              <ShieldCheck className="h-5 w-5 text-gold" />
            </div>
            <p className="text-xs text-muted-foreground">
              The shield indicates we manually check each payment — it is not a bKash verification
              badge.
            </p>

            <Card className="space-y-3 bg-background p-5">
              <div className="rounded-lg bg-gold/10 p-3 text-center">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Send this exact amount
                </p>
                <p className="font-display text-3xl text-primary">{formatBDT(total)}</p>
              </div>
              {paymentConfigured ? (
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Nongorr bKash payment number (Personal)
                    </p>
                    <p className="font-mono text-xl font-semibold tracking-wider text-foreground">
                      {BRAND.bkashNumber}
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={copyNumber}>
                    <Copy className="h-4 w-4" /> Copy
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg border border-gold/40 bg-gold/5 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-gold">
                    Payment number not set up yet
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{PAYMENT_NOTICE}</p>
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                Reference:{" "}
                <span className="font-medium text-foreground">{name.trim() || "Your name"}</span>
              </p>
            </Card>

            {paymentConfigured ? (
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>Open bKash → Send Money</li>
                <li>
                  Enter {BRAND.bkashNumber} and the exact amount {formatBDT(total)}
                </li>
                <li>Complete payment and copy the TrxID</li>
                <li>Enter your TrxID below</li>
              </ol>
            ) : (
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>Message us on WhatsApp to receive the current payment number</li>
                <li>Send the exact amount {formatBDT(total)}</li>
                <li>Complete payment and copy the TrxID</li>
                <li>Enter your TrxID below</li>
              </ol>
            )}
            <p className="text-xs text-muted-foreground">
              Your payment is confirmed manually by our team after you place the order — there is no
              automatic gateway.
            </p>

            <Field
              label="Transaction ID (TrxID)"
              required
              error={errors.trxId}
              fieldRef={refs.trxId}
            >
              <Input
                value={trxId}
                onChange={(e) => setTrxId(e.target.value.toUpperCase())}
                placeholder="E.G. 8N7A6B5C4D"
                className={cn(
                  "font-mono uppercase tracking-wider",
                  trxId && (trxValid ? "border-green-500" : "border-destructive"),
                )}
              />
            </Field>

            <Field label="Payment screenshot (optional, recommended)">
              {screenshot ? (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
                  <Dialog>
                    <DialogTrigger asChild>
                      <button type="button" className="shrink-0">
                        <img
                          src={screenshot.url}
                          alt="Payment screenshot preview"
                          className="h-16 w-16 rounded object-cover"
                        />
                      </button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg">
                      <DialogHeader>
                        <DialogTitle>Payment screenshot</DialogTitle>
                      </DialogHeader>
                      <img
                        src={screenshot.url}
                        alt="Payment screenshot enlarged"
                        className="max-h-[70vh] w-full rounded object-contain"
                      />
                    </DialogContent>
                  </Dialog>
                  <span className="flex-1 truncate text-sm text-muted-foreground">
                    {screenshot.file.name}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Replace
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={removeScreenshot}>
                    <X className="h-4 w-4" /> Remove
                  </Button>
                </div>
              ) : (
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    acceptFile(e.dataTransfer.files?.[0]);
                  }}
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-border bg-background p-5 text-center text-sm text-muted-foreground hover:border-primary",
                    dragOver && "border-primary bg-primary/5",
                  )}
                >
                  <Upload className="h-5 w-5" />
                  <span>Drag & drop or tap to upload</span>
                  <span className="text-xs">JPEG, PNG or WebP · up to 5 MB</span>
                </label>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={onPickFile}
              />
              {screenshotError && (
                <p className="mt-1 text-xs text-destructive">{screenshotError}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Previewed in your browser only — nothing is uploaded yet.
              </p>
            </Field>
          </section>
        </div>

        {/* Summary / Review */}
        <div className="site-sticky-with-gap h-fit space-y-4 rounded-xl border border-border bg-card p-6 lg:sticky">
          <h2 className="font-display text-2xl text-foreground">Order Review</h2>

          {/* Customer + address */}
          {deliveryComplete && (
            <div className="rounded-lg border border-border bg-background p-3 text-sm">
              <p className="font-medium text-foreground">{name.trim()}</p>
              <p className="text-muted-foreground">{phoneValue}</p>
              <p className="text-muted-foreground">
                {address.trim()}, {locality}, {district}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Zone: {zoneLabel(deliveryZone)}</p>
            </div>
          )}

          <div className="space-y-3">
            {cart.map((i) => (
              <div key={i.id} className="flex gap-3">
                <img
                  src={i.image}
                  alt={i.name}
                  loading="lazy"
                  className="h-14 w-12 rounded object-cover"
                />
                <div className="flex-1 text-sm">
                  <p className="line-clamp-1 font-medium text-foreground">{i.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Qty {i.qty}
                    {i.size ? ` · ${i.size}` : ""}
                    {i.customSize ? " · Custom measurements" : ""}
                  </p>
                  {i.customSize && (
                    <Collapsible>
                      <CollapsibleTrigger className="flex items-center gap-1 text-xs text-gold">
                        Measurements <ChevronDown className="h-3 w-3" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="text-xs text-muted-foreground">
                        {Object.entries(i.customSize)
                          .map(([k, v]) => `${k} ${v}"`)
                          .join(", ")}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Base {formatBDT(i.price)}
                    {i.customCharge ? ` + ${formatBDT(i.customCharge)} custom` : ""} / unit
                  </p>
                </div>
                <span className="text-sm font-medium">
                  {formatBDT((i.price + (i.customCharge ?? 0)) * i.qty)}
                </span>
              </div>
            ))}
          </div>

          <Separator />
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Products subtotal</span>
              <span>{formatBDT(baseSubtotal)}</span>
            </div>
            {customChargesTotal > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Custom-size charges</span>
                <span>{formatBDT(customChargesTotal)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatBDT(cartSubtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-gold">
                <span>Discount ({appliedCoupon?.code})</span>
                <span>− {formatBDT(discount)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Delivery ({zoneLabel(deliveryZone)})</span>
              <span>{shipping === 0 ? "Free" : formatBDT(shipping)}</span>
            </div>
          </div>
          <Separator />
          <div className="flex justify-between">
            <span className="font-display text-lg">Total</span>
            <span className="font-display text-xl text-primary">{formatBDT(total)}</span>
          </div>

          {/* Notes + payment meta */}
          {orderNote.trim() && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Order note:</span> {orderNote.trim()}
            </p>
          )}
          {deliveryNote.trim() && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Delivery note:</span>{" "}
              {deliveryNote.trim()}
            </p>
          )}
          {paymentConfigured && (
            <p className="text-xs text-muted-foreground">
              bKash number: <span className="font-mono">{BRAND.bkashNumber}</span>
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            TrxID:{" "}
            <span className="font-mono">{trxId.trim() ? trxId.trim().toUpperCase() : "—"}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Payment screenshot: {screenshot ? "Attached" : "Not attached"}
          </p>

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Placing order…
              </>
            ) : (
              "Place Order for Verification"
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Your order will be confirmed after manual payment verification. We may contact you
            through WhatsApp if clarification is needed.
          </p>
          <p className="text-center text-xs text-muted-foreground">
            Questions about payment or delivery? See our{" "}
            <Link to="/faq" className="text-primary underline-offset-2 hover:underline">
              FAQ
            </Link>{" "}
            or{" "}
            <Link to="/contact" className="text-primary underline-offset-2 hover:underline">
              contact us
            </Link>
            .
          </p>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  children,
  error,
  fieldRef,
  hint,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  error?: string;
  fieldRef?: React.RefObject<HTMLDivElement | null>;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5" ref={fieldRef}>
      <Label className="text-sm">
        {label}
        {required && <span className="text-primary"> *</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
