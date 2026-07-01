import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAccountUI } from "@/lib/account-ui";
import { listMyOrdersFn } from "@/lib/orders.api";
import { CustomerStatusBadge } from "@/components/admin/order-status";
import { type MyOrderListItem } from "@/lib/orders-shared";
import { formatBDT, BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Package,
  MapPin,
  Ruler,
  Heart,
  Truck,
  ShoppingBag,
  MessageCircle,
  Mail,
  ArrowRight,
} from "lucide-react";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/_site/account/")({
  component: AccountOverview,
});

function AccountOverview() {
  const { hydrated, profile, addresses, measurements } = useAccountUI();
  const { wishlist } = useStore();
  const [orders, setOrders] = useState<MyOrderListItem[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [ordersLoading, setOrdersLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void listMyOrdersFn({ data: { limit: 5 } })
      .then((res) => {
        if (!live) return;
        if (res.success) {
          setOrders(res.orders);
          setOrderTotal(res.total);
        }
      })
      .finally(() => live && setOrdersLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const recent = orders[0];

  const stats = useMemo(
    () => [
      {
        label: "Orders",
        value: orderTotal,
        icon: Package,
        to: "/orders" as const,
      },
      {
        label: "Saved addresses",
        value: addresses.length,
        icon: MapPin,
        to: "/account/addresses" as const,
      },
      {
        label: "Measurement profiles",
        value: measurements.length,
        icon: Ruler,
        to: "/account/measurements" as const,
      },
      {
        label: "Wishlist items",
        value: wishlist.length,
        icon: Heart,
        to: "/wishlist" as const,
      },
    ],
    [orderTotal, addresses.length, measurements.length, wishlist.length],
  );

  if (!hydrated) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl text-foreground">Welcome back, {profile.name}</h2>
        <p className="text-sm text-muted-foreground">
          Here is a quick snapshot of your account activity.
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            to={s.to}
            className="group rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
          >
            <div className="flex items-center justify-between">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-primary">
                <s.icon className="h-5 w-5" />
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </div>
            <p className="mt-3 font-display text-2xl text-foreground">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </Link>
        ))}
      </div>

      {/* Recent order */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg text-foreground">Recent order</h3>
          <Button asChild variant="ghost" size="sm">
            <Link to="/orders">View all</Link>
          </Button>
        </div>
        {ordersLoading ? (
          <Skeleton className="h-20 rounded-xl" />
        ) : recent ? (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <p className="font-medium text-foreground">Order {recent.orderNo}</p>
              <p className="text-sm text-muted-foreground">
                {recent.itemCount} item
                {recent.itemCount === 1 ? "" : "s"} · {formatBDT(recent.total)}
              </p>
              <div className="mt-2">
                <CustomerStatusBadge status={recent.status} />
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/orders/$id" params={{ id: recent.id }}>
                <Truck className="mr-2 h-4 w-4" /> Track
              </Link>
            </Button>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border bg-secondary/30 px-4 py-6 text-center text-sm text-muted-foreground">
            No orders yet.
          </p>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-3 font-display text-lg text-foreground">Quick actions</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button asChild variant="outline" className="justify-start">
              <Link to="/shop">
                <ShoppingBag className="mr-2 h-4 w-4" /> Browse shop
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link to="/track">
                <Truck className="mr-2 h-4 w-4" /> Track an order
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link to="/account/measurements">
                <Ruler className="mr-2 h-4 w-4" /> Manage measurements
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link to="/wishlist">
                <Heart className="mr-2 h-4 w-4" /> View wishlist
              </Link>
            </Button>
          </div>
        </div>

        {/* Support */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-1 font-display text-lg text-foreground">Need help?</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Our boutique team is happy to assist with orders, custom sizes and styling.
          </p>
          <div className="grid gap-2">
            <Button asChild variant="outline" className="justify-start">
              <a href={`https://wa.me/${BRAND.whatsapp}`} target="_blank" rel="noreferrer">
                <MessageCircle className="mr-2 h-4 w-4" /> Chat on WhatsApp
              </a>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <a href={`mailto:${BRAND.email}`}>
                <Mail className="mr-2 h-4 w-4" /> {BRAND.email}
              </a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
