/**
 * Demo-commerce gating.
 *
 * The real order / payment / courier backend is Stage 3 and does not exist yet.
 * The current checkout only fabricates an order in localStorage and shows a
 * success page. That is fine for development and previews, but it must NEVER run
 * for a real customer in production — they would believe an order was placed when
 * nothing was recorded. So simulated commerce (checkout success + the seeded demo
 * order history) is enabled ONLY in local dev, or when explicitly turned on for a
 * non-production preview via `VITE_ENABLE_DEMO_CHECKOUT=true`.
 *
 * In production it is OFF: checkout fails closed and points the customer at a real
 * ordering channel (WhatsApp) instead of returning a fake confirmation.
 *
 * `import.meta.env.DEV` is true only for `vite dev`; a production `vite build`
 * sets it false, so this fails closed by default.
 */
export function isDemoCommerceEnabled(): boolean {
  return import.meta.env.DEV === true || import.meta.env.VITE_ENABLE_DEMO_CHECKOUT === "true";
}
