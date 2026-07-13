import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Layout route for the customer order area. It only renders the matched child
 * (`/orders` → the list index, `/orders/:id` → the detail page). Without this
 * Outlet the nested detail route could never render.
 */
export const Route = createFileRoute("/_site/orders")({
  component: OrdersLayout,
});

function OrdersLayout() {
  return <Outlet />;
}
