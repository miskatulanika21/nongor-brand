import { createFileRoute, Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useStore } from "@/lib/store";
import { formatBDT, PAYMENT_NOTICE } from "@/lib/brand";

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
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
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
  CreditCard,
  Banknote,
  MapPin,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { computeShipping, suggestDeliveryZoneForDistrict, zoneLabel } from "@/lib/checkout-ui";
import { LocationPicker, type LocationSelection } from "@/components/checkout/LocationPicker";
import {
  enabledMethodList,
  isManualMethod,
  cartToQuoteLines,
  cartToPlaceLines,
  placementSignature,
  sha256Hex,
  checkoutErrorMessage,
  type PaymentMethod,
  type QuoteResult,
} from "@/lib/checkout-shared";
import { loadOrCreateAttempt, clearCheckoutAttempt } from "@/lib/checkout-attempt";
import { quoteOrderFn, placeOrderFn } from "@/lib/checkout.api";
import { submitPaymentEvidenceFn } from "@/lib/evidence.api";
import { fileToEvidencePayload } from "@/lib/evidence-shared";
import type { PublicSettings } from "@/lib/settings.schema";
import {
  useAccountPrefill,
  checkoutAddressMatchesSaved,
  type SavedAddress,
} from "@/lib/account-ui";
import { upsertAddressFn } from "@/lib/account.api";
import { absUrl } from "@/lib/site-config";

export const Route = createFileRoute("/_site/checkout")({
  head: () => ({
    meta: [
      { title: "Checkout · Nongorr" },
      {
        name: "description",
        content:
          "Complete your Nongorr purchase. Enter delivery details, choose your payment method, and place your order.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: absUrl("/checkout") }],
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

/** Human-readable label for each payment method. */
const METHOD_LABEL: Record<PaymentMethod, string> = {
  cod: "Cash on Delivery",
  bkash: "bKash (Send Money)",
  nagad: "Nagad (Send Money)",
};

const METHOD_ICON: Record<PaymentMethod, React.ElementType> = {
  cod: Banknote,
  bkash: CreditCard,
  nagad: CreditCard,
};

function Checkout() {
  const {
    cart,
    cartHydrated,
    cartSubtotal,
    clearCart,
    deliveryZone,
    setDeliveryZone,
    couponCode,
    deliveryNote,
    setDeliveryNote,
    orderNote,
  } = useStore();
  const navigate = useNavigate();

  const { sessionSummary, publicSettings } = useRouteContext({ from: "/_site" }) as {
    sessionSummary: { isAuthenticated: boolean };
    publicSettings: PublicSettings | null;
  };
  const signedIn = sessionSummary.isAuthenticated;

  // ── Payment method ──────────────────────────────────────────────────────
  const methods = enabledMethodList(publicSettings);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>(methods[0] ?? "cod");

  // Keep selection valid if methods change (e.g. settings update)
  useEffect(() => {
    if (!methods.includes(selectedMethod)) {
      setSelectedMethod(methods[0] ?? "cod");
    }
  }, [methods, selectedMethod]);

  const isManual = isManualMethod(selectedMethod);

  // ── Form state ──────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [district, setDistrict] = useState("");
  const [area, setArea] = useState("");
  const [thana, setThana] = useState("");
  // Row ids behind the chosen names. Kept beside the names rather than replacing
  // them: ship_district / ship_area stay text (the fee tier reads the district
  // name), while the ids give the courier an exact Pathao zone to book against.
  const [locationIds, setLocationIds] = useState<{
    districtId?: number;
    thanaId?: number;
    areaId?: number;
  }>({});
  const [address, setAddress] = useState("");
  const [trxId, setTrxId] = useState("");
  const [screenshot, setScreenshot] = useState<ScreenshotPreview | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  // ── Saved addresses (signed-in prefill, Stage 4 P5) ─────────────────────
  const { addresses: savedAddresses } = useAccountPrefill(signedIn);
  const [appliedAddressId, setAppliedAddressId] = useState<string | null>(null);
  const [saveAddress, setSaveAddress] = useState(false);
  const autoApplied = useRef(false);

  const applySavedAddress = useCallback(
    (a: SavedAddress) => {
      setAppliedAddressId(a.id);
      setName(a.recipient);
      setPhone(a.phone);
      setDistrict(a.district);
      const mapped = suggestDeliveryZoneForDistrict(a.district);
      if (mapped) setDeliveryZone(mapped);
      // A saved address stores one free-text locality, with no record of which
      // level it came from. Treat it as the thana/upazila (level 3): that is
      // where a Dhaka "Dhanmondi" genuinely belongs now — it is a Pathao zone,
      // not a sub-area — and the picker resolves it by name within the
      // district. If it does not resolve, the field simply stays unset and the
      // customer picks again, which is safe.
      setThana(a.area);
      setArea("");
      setAddress(a.address);
    },
    [setDeliveryZone],
  );

  // Pre-apply the default saved address once — but never clobber a form the
  // customer already started typing into.
  useEffect(() => {
    if (autoApplied.current || savedAddresses.length === 0) return;
    autoApplied.current = true;
    if (name || phone || district || address) return;
    const preferred = savedAddresses.find((a) => a.isDefault) ?? savedAddresses[0];
    applySavedAddress(preferred);
  }, [savedAddresses, name, phone, district, address, applySavedAddress]);

  function startNewAddress() {
    setAppliedAddressId(null);
    setName("");
    setPhone("");
    setDistrict("");
    setArea("");
    setThana("");
    setLocationIds({});
    setAddress("");
  }

  // ── Server-authoritative quote ──────────────────────────────────────────
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  // Monotonic request id: only the NEWEST quote may update amount/token/error, so
  // a slow earlier response can never overwrite a faster later one (#4).
  const quoteSeq = useRef(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  // Cleanup object URL on unmount.
  useEffect(() => {
    return () => {
      if (screenshotRef.current) URL.revokeObjectURL(screenshotRef.current.url);
    };
  }, []);

  // Clear inline errors (and the announced summary) as the customer corrects a
  // field. Errors are only ADDED on submit — this only ever removes resolved
  // ones so stale messages never linger.
  useEffect(() => {
    setErrors((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const fresh = validate();
      const next: Errors = {};
      for (const k of Object.keys(prev)) if (fresh[k]) next[k] = prev[k];
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
    // validate() reads the latest field state; re-run whenever an input changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, phone, district, area, thana, address, trxId, selectedMethod, isManual]);

  // ── Fetch quote on mount + when cart/zone changes ──────────────────────
  const fetchQuote = useCallback(async () => {
    const lines = cartToQuoteLines(cart);
    if (lines.length === 0) return;
    const seq = ++quoteSeq.current;
    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const result = await quoteOrderFn({
        data: { lines, zone: deliveryZone, coupon: couponCode ?? undefined },
      });
      if (seq !== quoteSeq.current) return; // a newer quote superseded this one
      if (result.success) {
        setQuote(result.quote);
      } else {
        // The newest quote failed → drop any stale quote so an older price is
        // never shown as current; submission is gated on a verified quote below.
        setQuote(null);
        setQuoteError(result.error);
      }
    } catch {
      if (seq !== quoteSeq.current) return;
      setQuote(null);
      setQuoteError("Could not verify prices. Please retry before placing your order.");
    } finally {
      if (seq === quoteSeq.current) setQuoteLoading(false);
    }
  }, [cart, deliveryZone, couponCode]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  // ── Totals (prefer server quote, fall back to client) ──────────────────
  const serverSubtotal = quote?.subtotal ?? null;
  const serverShipping = quote?.shipping_fee ?? null;
  const serverTotal = quote?.total ?? null;

  // Coupon + discount are server truth (from the quote). The coupon is only sent
  // to place_order when the current quote confirms it applies, so a stale/expired
  // code silently drops (no discount) instead of blocking checkout.
  const couponStatus = quote?.coupon ?? null;
  const discount = quote?.discount ?? 0;

  const clientShipping = computeShipping(deliveryZone, cartSubtotal);
  const clientTotal = Math.max(0, cartSubtotal - discount) + clientShipping;

  const displaySubtotal = serverSubtotal ?? cartSubtotal;
  const displayShipping = serverShipping ?? clientShipping;
  const displayTotal = serverTotal ?? clientTotal;

  // The order may only be placed against a server-verified quote — never a stale
  // or client-only total. A failed/among-flight quote blocks submission (#4).
  const pricingVerified = quote !== null && !quoteError;

  const baseSubtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const customChargesTotal = cart.reduce(
    (sum, item) => sum + (item.customCharge ?? 0) * item.qty,
    0,
  );

  const phoneValue = normalizePhone(phone);
  const phoneValid = BD_PHONE.test(phoneValue);
  const trxValid = trxId.trim().length >= 10;
  // The finest location the customer actually chose. Area/union when one was
  // picked, otherwise the thana/upazila — some metropolitan thanas legitimately
  // list no sub-areas, and requiring one there would make checkout impossible
  // for those customers.
  const locality = area.trim() || thana.trim();

  const deliveryComplete = Boolean(
    name.trim() && phoneValid && district && locality && address.trim(),
  );
  const paymentComplete = isManual ? trxValid : true; // COD needs no TrxID
  const STEPS = isManual
    ? (["Delivery", "Payment", "Review", "Submit"] as const)
    : (["Delivery", "Review", "Submit"] as const);
  const activeStep = !deliveryComplete
    ? 1
    : isManual && !paymentComplete
      ? 2
      : submitting
        ? STEPS.length
        : STEPS.length - 1;

  // Wait for the persisted cart to hydrate before deciding it's empty — a hard
  // reload with items in localStorage must not flash "Nothing to checkout" (#5).
  if (!cartHydrated) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6" aria-busy="true">
        <Skeleton className="mb-6 h-10 w-48" />
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
        <span className="sr-only">Loading your checkout…</span>
      </div>
    );
  }

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
    const num =
      selectedMethod === "bkash"
        ? (publicSettings?.bkash_number ?? "")
        : selectedMethod === "nagad"
          ? (publicSettings?.nagad_number ?? "")
          : "";
    if (!num) {
      toast.info("Payment number is not set up yet — please contact us on WhatsApp.");
      return;
    }
    try {
      await navigator.clipboard.writeText(num);
      toast.success("Number copied");
    } catch {
      toast.error("Could not copy the number");
    }
  }

  function validate(): Errors {
    const err: Errors = {};
    if (!name.trim()) err.name = "Please enter your name";
    if (!phoneValid) err.phone = "Enter a valid Bangladesh number (e.g. 01712345678)";
    if (!district) err.district = "Please select your division and district";
    // Area/union is optional — a thana with no listed sub-areas is legitimate.
    if (!thana.trim()) err.locality = "Please select your thana / upazila";
    if (!address.trim()) err.address = "Please enter your full address";
    if (isManual && !trxValid) err.trxId = "TrxID must be at least 10 characters";
    return err;
  }

  const ERROR_ORDER = ["name", "phone", "district", "locality", "address", "trxId"];

  function scrollToFirstError(err: Errors) {
    const first = ERROR_ORDER.find((k) => err[k]);
    if (first && refs[first]?.current) {
      refs[first].current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  /** Move keyboard focus to a field's control from the error summary. */
  function focusField(key: string) {
    const control = refs[key]?.current?.querySelector<HTMLElement>(
      "input, textarea, [role='combobox'], button",
    );
    control?.focus();
    control?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /**
   * Opt-in address save-back — fired AFTER a successful order placement.
   * Strictly best-effort and fire-and-forget: it never blocks or delays the
   * order-success redirect, and an exact duplicate of a saved address is
   * silently skipped. (Stage 4 P5.)
   */
  function saveAddressToAccount() {
    if (!signedIn || !saveAddress) return;
    const current = {
      recipient: name.trim(),
      phone: phoneValue,
      district,
      area: locality,
      address: address.trim(),
    };
    if (savedAddresses.some((s) => checkoutAddressMatchesSaved(current, s))) return;
    void upsertAddressFn({ data: { ...current, isDefault: savedAddresses.length === 0 } })
      .then((res) => {
        if (res.success) toast.success("Address saved to your account for next time.");
      })
      .catch(() => {
        // best-effort only — the customer is already on the success page
      });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    // Never place an order without a fresh, server-verified quote (#4).
    if (!pricingVerified) {
      toast.error("We couldn't verify prices. Please retry before placing your order.");
      void fetchQuote();
      return;
    }
    const err = validate();
    setErrors(err);
    if (Object.keys(err).length) {
      // Move focus to the announced summary so AT users hear what failed,
      // then reveal the first offending field.
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      scrollToFirstError(err);
      return;
    }

    setSubmitting(true);

    try {
      // Place carries per-line measurements (made-to-measure); quote does not.
      const lines = cartToPlaceLines(cart);
      const customer = {
        name: name.trim(),
        phone: phoneValue,
        district,
        address: address.trim(),
        area: locality || undefined,
        // Level 3 + resolved ids, so the courier can address the parcel by
        // Pathao zone instead of having Pathao parse the free-text address.
        // All optional — a missing id degrades to auto-address, never a failure.
        thana: thana.trim() || undefined,
        districtId: locationIds.districtId,
        thanaId: locationIds.thanaId,
        areaId: locationIds.areaId,
      };
      const couponForOrder = couponStatus?.applied ? (couponCode ?? undefined) : undefined;

      // One persisted attempt per logical placement: retries of the SAME order
      // reuse this key + guest token (server replays → no duplicate; the tracking
      // link stays valid). The raw token never leaves the browser — only its hash
      // is sent. A guest checkout requires it; a signed-in order ignores it.
      const signature = placementSignature({
        lines,
        customer,
        zone: deliveryZone,
        method: selectedMethod,
        coupon: couponForOrder,
      });
      const attempt = loadOrCreateAttempt(signature);
      const guestTokenHash = signedIn ? undefined : await sha256Hex(attempt.guestToken);

      const result = await placeOrderFn({
        data: {
          lines,
          customer,
          zone: deliveryZone,
          method: selectedMethod,
          idempotencyKey: attempt.idempotencyKey,
          quoteToken: quote?.quote_token,
          coupon: couponForOrder,
          guestTokenHash,
        },
      });

      if (result.success) {
        saveAddressToAccount();
        // Submit payment evidence for manual methods. This replaces the old
        // localStorage TrxID stash: the screenshot is uploaded to the private
        // evidence bucket and the order flips to payment_submitted server-side.
        // A failure here never undoes the placed order — we warn and continue.
        if (isManual && trxId.trim()) {
          try {
            const shot = screenshot ? await fileToEvidencePayload(screenshot.file) : null;
            const ev = await submitPaymentEvidenceFn({
              data: {
                orderId: result.order.order_id,
                trxId: trxId.trim().toUpperCase(),
                senderNumber: phoneValue || undefined,
                guestToken: signedIn ? undefined : attempt.guestToken,
                screenshot: shot ?? undefined,
              },
            });
            if (ev.success) {
              if (ev.duplicateWarning) {
                toast.warning(
                  "We noticed this TrxID was used before — our team will verify it manually.",
                );
              }
            } else {
              toast.warning(
                "Order placed, but we couldn't record your payment proof. You can resend it from your order page.",
              );
            }
          } catch {
            toast.warning("Order placed, but we couldn't record your payment proof.");
          }
        }

        // Definitive success — this attempt is spent; the next checkout is a new
        // placement. (A guest keeps its token via the success URL below.)
        clearCheckoutAttempt();
        clearCart();
        // Navigate to order-success with the CAPABILITY only — the success page
        // fetches + verifies the order server-side (never trusts these params).
        // Signed-in orders carry no guest token (owner-scoped lookup is used).
        navigate({
          to: "/order-success",
          search: {
            order_id: result.order.order_id,
            order_no: result.order.order_no,
            token: signedIn ? undefined : attempt.guestToken,
          },
        });
      } else {
        // Handle known checkout errors
        const code = "code" in result ? result.code : undefined;
        const message = result.error || checkoutErrorMessage(code);

        if (code === "price_changed") {
          // Prices drifted — re-fetch and let the customer re-confirm. The SAME
          // attempt is kept: nothing was committed (the RPC rolled back), and the
          // lines are unchanged, so the persisted key stays valid for the retry.
          toast.warning(message);
          await fetchQuote();
        } else if (code === "out_of_stock" || code === "product_not_purchasable") {
          toast.error(message);
          // The cart must change to proceed → the next placement is a new attempt.
          clearCheckoutAttempt();
          navigate({ to: "/cart" });
          return;
        } else {
          // Any other server error is a definitive, rolled-back failure. We KEEP
          // the attempt so a retry reuses the same key (never a duplicate order).
          toast.error(message);
        }
      }
    } catch {
      // Ambiguous transport failure: the order MAY have committed. Keep the
      // attempt so a retry replays onto the same order instead of duplicating it.
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Payment number to display for manual methods ───────────────────────
  // Customer-facing receive number for the selected manual method, from live
  // settings (admin-managed). Falls back to null → the UI shows the WhatsApp CTA.
  const paymentNumber =
    selectedMethod === "bkash"
      ? (publicSettings?.bkash_number ?? null)
      : selectedMethod === "nagad"
        ? (publicSettings?.nagad_number ?? null)
        : null;
  const hasPaymentNumber = Boolean(
    paymentNumber && !/0{6,}/.test(paymentNumber.replace(/\D/g, "")),
  );

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
          {/* Announced validation summary — focused on submit failure (AUD-03) */}
          {Object.keys(errors).length > 0 && (
            <div
              ref={errorSummaryRef}
              tabIndex={-1}
              role="alert"
              aria-labelledby="checkout-error-summary-title"
              className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            >
              <p id="checkout-error-summary-title" className="text-sm font-medium text-destructive">
                Please fix {Object.keys(errors).length} field
                {Object.keys(errors).length > 1 ? "s" : ""} before placing your order:
              </p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
                {ERROR_ORDER.filter((k) => errors[k]).map((k) => (
                  <li key={k}>
                    <button
                      type="button"
                      onClick={() => focusField(k)}
                      className="text-left text-destructive underline underline-offset-2 hover:no-underline"
                    >
                      {errors[k]}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Delivery */}
          <section className="space-y-4 rounded-xl border border-border bg-card p-6">
            <h2 className="font-display text-2xl text-foreground">Delivery Details</h2>

            {/* Saved addresses — one-tap prefill for signed-in customers */}
            {signedIn && savedAddresses.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Your saved addresses
                </p>
                <div className="flex flex-wrap gap-2">
                  {savedAddresses.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => applySavedAddress(a)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                        appliedAddressId === a.id
                          ? "border-primary bg-primary/10 font-medium text-primary"
                          : "border-border bg-background text-muted-foreground hover:border-primary/50",
                      )}
                    >
                      <MapPin className="h-3 w-3 shrink-0" />
                      {a.label || a.recipient} · {a.area}
                      {a.isDefault && <span className="text-gold">★</span>}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={startNewAddress}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs transition-colors",
                      appliedAddressId === null
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "border-dashed border-border bg-background text-muted-foreground hover:border-primary/50",
                    )}
                  >
                    + New address
                  </button>
                </div>
              </div>
            )}

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
                htmlFor="checkout-phone"
              >
                <div className="relative">
                  <Input
                    id="checkout-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    aria-invalid={errors.phone ? true : undefined}
                    aria-describedby={errors.phone ? "checkout-phone-error" : "checkout-phone-hint"}
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

              {/* Division → District → Thana/Upazila → Area/Union.
                  Replaces the old split where only Dhaka got a curated area
                  list and every other district got a free-text thana box —
                  which is why addresses outside Dhaka reached the courier
                  unstructured. The picker reports NAMES, so submission,
                  saved addresses and the district-derived fee tier are all
                  unchanged. */}
              <div className="sm:col-span-2" ref={refs.district}>
                <div ref={refs.locality}>
                  <LocationPicker
                    // The ids must round-trip: the picker spreads the incoming
                    // value to preserve levels above the one being changed, so
                    // omitting them here silently dropped districtId and
                    // thanaId as soon as a lower level was picked (caught by
                    // placing a real order — types and tests were both happy).
                    value={{ district, thana, area, ...locationIds }}
                    onChange={(next: LocationSelection) => {
                      setDistrict(next.district);
                      setThana(next.thana);
                      setArea(next.area);
                      setLocationIds({
                        districtId: next.districtId,
                        thanaId: next.thanaId,
                        areaId: next.areaId,
                      });
                      if (next.district) {
                        const mapped = suggestDeliveryZoneForDistrict(next.district);
                        if (mapped) setDeliveryZone(mapped);
                      }
                    }}
                    districtError={Boolean(errors.district)}
                    localityError={Boolean(errors.locality)}
                  />
                </div>
                {(errors.district || errors.locality) && (
                  <p
                    id="checkout-district-error"
                    className="mt-2 text-xs text-destructive"
                    role="alert"
                  >
                    {errors.district ?? errors.locality}
                  </p>
                )}
              </div>
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
            {signedIn && (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={saveAddress}
                  onCheckedChange={(v) => setSaveAddress(v === true)}
                  aria-label="Save this address to my account for next time"
                />
                Save this address to my account for next time
              </label>
            )}
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
                {displayShipping === 0 ? "Free delivery" : formatBDT(displayShipping)}
              </p>
            )}
          </section>

          {/* Payment method selector */}
          <section className="space-y-4 rounded-xl border border-gold/40 bg-gold/5 p-6">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-2xl text-foreground">Payment Method</h2>
              <ShieldCheck className="h-5 w-5 text-gold" />
            </div>

            {/* Method selector — only show if more than one option */}
            {methods.length > 1 && (
              <div
                role="radiogroup"
                aria-label="Payment method"
                className="grid gap-2 sm:grid-cols-3"
              >
                {methods.map((m, i) => {
                  const Icon = METHOD_ICON[m];
                  const selected = selectedMethod === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={METHOD_LABEL[m]}
                      // Roving tabindex + arrow-key selection (WAI-ARIA radiogroup, #9):
                      // only the checked radio is in the tab order; arrows move
                      // selection AND focus, wrapping around.
                      tabIndex={selected ? 0 : -1}
                      onKeyDown={(e) => {
                        const dir =
                          e.key === "ArrowRight" || e.key === "ArrowDown"
                            ? 1
                            : e.key === "ArrowLeft" || e.key === "ArrowUp"
                              ? -1
                              : 0;
                        if (dir === 0) return;
                        e.preventDefault();
                        const next = (i + dir + methods.length) % methods.length;
                        setSelectedMethod(methods[next]);
                        e.currentTarget.parentElement
                          ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                          [next]?.focus();
                      }}
                      onClick={() => setSelectedMethod(m)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border-2 p-3 text-left text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected
                          ? "border-primary bg-primary/5 font-medium text-foreground"
                          : "border-border bg-background text-muted-foreground hover:border-primary/50",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {METHOD_LABEL[m]}
                    </button>
                  );
                })}
              </div>
            )}

            {/* COD — simple confirmation */}
            {selectedMethod === "cod" && (
              <Card className="space-y-3 bg-background p-5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Banknote className="h-5 w-5 text-success" />
                  <span>Pay with cash when your order is delivered.</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Our courier will collect the payment at your doorstep. Please keep the exact
                  amount ready.
                </p>
              </Card>
            )}

            {/* Manual payment (bKash / Nagad) */}
            {isManual && (
              <>
                <p className="text-xs text-muted-foreground">
                  The shield indicates we manually check each payment — it is not a{" "}
                  {selectedMethod === "bkash" ? "bKash" : "Nagad"} verification badge.
                </p>

                <Card className="space-y-3 bg-background p-5">
                  <div className="rounded-lg bg-gold/10 p-3 text-center">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Send this exact amount
                    </p>
                    <p className="font-display text-3xl text-primary">
                      {quoteLoading ? (
                        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                      ) : (
                        formatBDT(displayTotal)
                      )}
                    </p>
                  </div>
                  {hasPaymentNumber ? (
                    <div className="flex items-center justify-between rounded-lg border border-border p-3">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Nongorr {selectedMethod === "bkash" ? "bKash" : "Nagad"} payment number
                          (Personal)
                        </p>
                        <p className="font-mono text-xl font-semibold tracking-wider text-foreground">
                          {paymentNumber}
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
                    <span className="font-medium text-foreground">
                      {name.trim() || "Your name"}
                    </span>
                  </p>
                </Card>

                {hasPaymentNumber ? (
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                    <li>Open {selectedMethod === "bkash" ? "bKash" : "Nagad"} → Send Money</li>
                    <li>
                      Enter {paymentNumber} and the exact amount {formatBDT(displayTotal)}
                    </li>
                    <li>Complete payment and copy the TrxID</li>
                    <li>Enter your TrxID below</li>
                  </ol>
                ) : (
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                    <li>Message us on WhatsApp to receive the current payment number</li>
                    <li>Send the exact amount {formatBDT(displayTotal)}</li>
                    <li>Complete payment and copy the TrxID</li>
                    <li>Enter your TrxID below</li>
                  </ol>
                )}
                <p className="text-xs text-muted-foreground">
                  Your payment is confirmed manually by our team after you place the order — there
                  is no automatic gateway.
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
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-3">
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
                      <span className="min-w-0 flex-1 basis-32 truncate text-sm text-muted-foreground">
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
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
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
                      aria-label="Upload payment screenshot"
                      aria-describedby={screenshotError ? "screenshot-error" : undefined}
                      className={cn(
                        "flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-border bg-background p-5 text-center text-sm text-muted-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        dragOver && "border-primary bg-primary/5",
                      )}
                    >
                      <Upload className="h-5 w-5" />
                      <span>Drag &amp; drop or tap to upload</span>
                      <span className="text-xs">JPEG, PNG or WebP · up to 5 MB</span>
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    tabIndex={-1}
                    onChange={onPickFile}
                    aria-label="Upload payment screenshot"
                  />
                  {screenshotError && (
                    <p id="screenshot-error" className="mt-1 text-xs text-destructive">
                      {screenshotError}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Previewed in your browser only — nothing is uploaded yet.
                  </p>
                </Field>
              </>
            )}
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
              <span>
                {formatBDT(displaySubtotal)}
                {quote && <span className="ml-1 text-xs text-success">✓</span>}
              </span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-gold">
                <span>Discount{couponStatus?.code ? ` (${couponStatus.code})` : ""}</span>
                <span>− {formatBDT(discount)}</span>
              </div>
            )}
            {couponStatus?.applied && couponStatus.type === "free_shipping" && (
              <div className="flex justify-between text-gold">
                <span>Free delivery ({couponStatus.code})</span>
                <span>− {formatBDT(couponStatus.shipping_waived ?? 0)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Delivery ({zoneLabel(deliveryZone)})</span>
              <span>{displayShipping === 0 ? "Free" : formatBDT(displayShipping)}</span>
            </div>
          </div>
          <Separator />
          <div className="flex justify-between">
            <span className="font-display text-lg">Total</span>
            <span className="font-display text-xl text-primary">
              {quoteLoading ? (
                <Loader2 className="inline h-4 w-4 animate-spin" />
              ) : (
                formatBDT(displayTotal)
              )}
            </span>
          </div>

          {/* Quote error warning + retry (submission is blocked until verified) */}
          {quoteError && (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 rounded-lg border border-gold/40 bg-gold/5 p-2 text-xs text-muted-foreground"
            >
              <span>{quoteError}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fetchQuote()}
                disabled={quoteLoading}
              >
                Retry
              </Button>
            </div>
          )}

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
          <p className="text-xs text-muted-foreground">
            Payment:{" "}
            <span className="font-medium text-foreground">{METHOD_LABEL[selectedMethod]}</span>
          </p>
          {isManual && (
            <p className="text-xs text-muted-foreground">
              TrxID:{" "}
              <span className="font-mono">{trxId.trim() ? trxId.trim().toUpperCase() : "—"}</span>
            </p>
          )}
          {isManual && (
            <p className="text-xs text-muted-foreground">
              Payment screenshot: {screenshot ? "Attached" : "Not attached"}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={submitting || quoteLoading || !pricingVerified}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Placing order…
              </>
            ) : quoteLoading ? (
              "Verifying prices…"
            ) : selectedMethod === "cod" ? (
              "Place Order (Cash on Delivery)"
            ) : (
              "Place Order for Verification"
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {selectedMethod === "cod"
              ? "Your order will be confirmed and scheduled for delivery."
              : "Your order will be confirmed after manual payment verification. We may contact you through WhatsApp if clarification is needed."}
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
  htmlFor,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  error?: string;
  fieldRef?: React.RefObject<HTMLDivElement | null>;
  hint?: string;
  /**
   * Escape hatch: when the control isn't the direct child (e.g. a wrapped
   * input) the caller sets this to the control's own `id` and wires
   * `aria-describedby`/`aria-invalid` itself using `${htmlFor}-hint` /
   * `${htmlFor}-error`. Otherwise the id + ARIA are injected automatically.
   */
  htmlFor?: string;
}) {
  const autoId = useId();
  const controlId = htmlFor ?? autoId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const describedBy =
    [error ? errorId : null, hint && !error ? hintId : null].filter(Boolean).join(" ") || undefined;

  // Auto-wire the common case (control is the direct child). When `htmlFor` is
  // supplied the caller owns the wiring, so we don't clone.
  const control =
    !htmlFor && isValidElement(children)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          id: (children.props as Record<string, unknown>).id ?? controlId,
          "aria-invalid": error ? true : undefined,
          "aria-describedby":
            [(children.props as Record<string, unknown>)["aria-describedby"], describedBy]
              .filter(Boolean)
              .join(" ") || undefined,
        })
      : children;

  return (
    <div className="space-y-1.5" ref={fieldRef}>
      <Label htmlFor={controlId} className="text-sm">
        {label}
        {required && <span className="text-primary"> *</span>}
      </Label>
      {control}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
