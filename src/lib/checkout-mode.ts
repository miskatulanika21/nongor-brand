/**
 * Demo-commerce gating.
 *
 * The real order backend (Stage 3 Pass 3a) is now live: `api.quote_order` and
 * `api.place_order` are the authoritative checkout path. The checkout route
 * (`_site.checkout.tsx`) calls `placeOrderFn` directly — the demo gate has
 * been removed from that submit path.
 *
 * This flag is retained for legacy consumers only:
 *   - The order-success page (until P3b commit 8 rewires it to real data)
 *   - The seeded demo order history (ORDERS in orders.ts)
 *
 * `import.meta.env.DEV` is true only for `vite dev`; a production `vite build`
 * sets it false, so remaining demo paths fail closed by default.
 */
export function isDemoCommerceEnabled(): boolean {
  return import.meta.env.DEV === true || import.meta.env.VITE_ENABLE_DEMO_CHECKOUT === "true";
}
