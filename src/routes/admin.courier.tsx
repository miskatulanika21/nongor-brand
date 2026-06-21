import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { ORDERS, type Order, type OrderStatus } from "@/lib/orders";
import { formatBDT } from "@/lib/brand";
import { buildWaMessage, printParcelLabel, waLink } from "@/lib/admin-ops";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Printer, Truck, Copy, MessageCircle, MapPin } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/courier")({
  component: Courier,
});

// TODO: Replace this mock list with live "ready for courier" orders from backend.
// TODO: Wire courier partner selection + tracking ID to SteadFast / Pathao / RedX APIs.
const courierSeed: Order[] = [
  { ...ORDERS[0], id: "NGR-100231" },
  { ...ORDERS[2], id: "NGR-100250" },
  {
    ...ORDERS[1],
    id: "NGR-100261",
    status: "Confirmed" as OrderStatus,
    customer: "Lamia Haque",
    paymentStatus: "Verified",
  },
  {
    ...ORDERS[0],
    id: "NGR-100262",
    status: "Processing" as OrderStatus,
    customer: "Sadia Islam",
    trackingId: undefined,
    courier: undefined,
  },
  {
    ...ORDERS[1],
    id: "NGR-100255",
    status: "New Order" as OrderStatus,
    customer: "Mim Chowdhury",
    paymentStatus: "Pending",
  },
];

const COURIERS = [
  { value: "steadfast", label: "SteadFast" },
  { value: "pathao", label: "Pathao" },
  { value: "redx", label: "RedX" },
  { value: "sundarban", label: "Sundarban" },
  { value: "manual", label: "Manual" },
];

const READY: OrderStatus[] = ["Confirmed", "Processing"];

function copy(text: string, label: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success(`${label} copied`),
    () => toast.error("Copy failed"),
  );
}

function Courier() {
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const list = useMemo(
    () => (showAll ? courierSeed : courierSeed.filter((o) => READY.includes(o.status))),
    [showAll],
  );

  const selectedIds = Object.keys(selected).filter((k) => selected[k]);
  const allSelected = list.length > 0 && list.every((o) => selected[o.id]);

  const toggleAll = () => {
    if (allSelected) setSelected({});
    else setSelected(Object.fromEntries(list.map((o) => [o.id, true])));
  };

  return (
    <div>
      <AdminHeader
        title="Courier"
        description="Book parcels with your courier partner — ready for API automation later."
      />

      <div className="mb-4 rounded-xl border border-gold/40 bg-gold/5 p-3 text-sm text-muted-foreground">
        <Truck className="mr-1 inline h-4 w-4 text-gold" /> Courier API integration placeholder —
        currently managed manually.
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showAll} onCheckedChange={setShowAll} />
          {showAll ? "Showing all orders" : "Ready for courier (Confirmed / Processing)"}
        </label>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={allSelected} onCheckedChange={toggleAll} /> Select all
          </label>
          <Button
            size="sm"
            disabled={selectedIds.length === 0}
            onClick={() => {
              toast.success(`Bulk booked ${selectedIds.length} parcel(s) (demo)`);
              // TODO: send bulk booking request to courier API
            }}
          >
            Bulk book ({selectedIds.length})
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {list.map((o) => (
          <div key={o.id} className="rounded-xl border border-border bg-card p-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex gap-3">
                <Checkbox
                  className="mt-1"
                  checked={!!selected[o.id]}
                  onCheckedChange={(v) => setSelected((p) => ({ ...p, [o.id]: !!v }))}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-display text-lg text-foreground">{o.id}</p>
                    <Badge variant="outline" className="border-border text-muted-foreground">
                      {o.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-foreground">
                    {o.customer} · {o.phone}
                  </p>
                  <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {o.address}, {o.district}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-7 px-2 text-xs"
                    onClick={() =>
                      copy(`${o.customer}, ${o.phone}, ${o.address}, ${o.district}`, "Address")
                    }
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy address
                  </Button>
                  {o.trackingId && (
                    <Badge variant="outline" className="ml-1 border-primary/30 text-primary">
                      Tracking: {o.trackingId}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Courier partner</Label>
                  <Select defaultValue={o.courier?.toLowerCase() ?? "steadfast"}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COURIERS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tracking ID</Label>
                  <div className="flex gap-1.5">
                    <Input
                      className="h-9"
                      defaultValue={o.trackingId}
                      placeholder="Enter ID"
                      id={`trk-${o.id}`}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0 px-2"
                      onClick={() => {
                        const v =
                          (document.getElementById(`trk-${o.id}`) as HTMLInputElement)?.value ||
                          o.trackingId ||
                          "";
                        if (v) copy(v, "Tracking ID");
                        else toast.error("No tracking ID yet");
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="col-span-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => toast.success("Courier updated (demo)")}
                  >
                    Book courier
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => printParcelLabel(o)}>
                    <Printer className="h-4 w-4" /> Label
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a
                      href={waLink(o.phone, buildWaMessage("shipped", o))}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MessageCircle className="h-4 w-4 text-success" /> WhatsApp
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card py-12 text-center text-sm text-muted-foreground">
            No orders ready for courier right now.
          </div>
        )}
      </div>
    </div>
  );
}
