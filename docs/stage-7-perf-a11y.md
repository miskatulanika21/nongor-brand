# Stage 7 (P4) — Performance & Accessibility

**Date:** 2026-07-13.

## Accessibility — DONE

`e2e/a11y.spec.ts` runs **axe-core** (WCAG 2.0/2.1 **A + AA** rules) against the
seven customer-facing routes (home, shop, cart, checkout, login, size-guide,
contact) and fails on any **serious/critical** violation. Run it against any
deployment:

```
E2E_BASE_URL=https://nongor-brand.vercel.app npx playwright test e2e/a11y.spec.ts
```

**All seven routes pass.** The audit found and we fixed:

| Violation                                                                                                   | Fix                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `color-contrast` — gold `.eyebrow` text (#bf9752, ~2.5:1) on cream                                          | Darkened to a deep antique gold **#7d5e22** so it clears 4.5:1 on every cream/tint surface. Dark-surface eyebrows already override the colour, so they're unaffected. **(A visible brand tweak — the small eyebrow labels are now a deeper gold; tunable if you want it lighter, but it must stay ≥4.5:1.)** |
| `aria-input-field-name` — price range slider thumb had no name                                              | `Slider` gained a `thumbLabel` prop → the shop price slider is labelled "Price".                                                                                                                                                                                                                             |
| `button-name` — Radix Select triggers with no accessible name                                               | Added `aria-label` to every `SelectTrigger` (shop sort, cart/checkout delivery zone + district + area, contact reason).                                                                                                                                                                                      |
| `aria-prohibited-attr` — "coming soon" social icons were `<span aria-label>` (prohibited on a generic span) | Gave them `role="img"` (which permits `aria-label`) and dropped `aria-disabled`.                                                                                                                                                                                                                             |
| `color-contrast` — a muted italic note on Contact (3.7:1)                                                   | Removed the `/80` opacity so it uses full `text-muted-foreground`.                                                                                                                                                                                                                                           |

Keyboard/focus is provided by the Radix primitives (dialogs trap+restore focus,
`focus-visible` rings throughout); CLS is already **0** so nothing shifts under
the keyboard. A manual keyboard-only walkthrough of the checkout flow + admin
order actions is the remaining manual check (not automatable via axe).

## Performance — baseline captured

Lighthouse **mobile** (simulated Slow-4G), prod `nongor-brand.vercel.app`:

| Metric            | Value     | Target   |              |
| ----------------- | --------- | -------- | ------------ |
| Performance score | **74**    | —        |              |
| **LCP**           | **4.5 s** | < 2.5 s  | ❌ over      |
| FCP               | 3.5 s     | —        | high         |
| **CLS**           | **0**     | < 0.1    | ✅           |
| TBT               | 200 ms    | < 200 ms | ~ borderline |
| Total transfer    | 795 KiB   | —        |              |

The hero `<img>` (the LCP element) is already optimal — `loading="eager"`,
`fetchpriority="high"`, responsive `srcset`, AVIF/WebP via the Vercel image CDN.
**LCP is anchored by FCP (3.5 s)**, which is driven by the initial payload, not
the image. Top Lighthouse opportunity: **reduce unused JavaScript (~241 KiB /
510 ms)**.

Client bundle shape (largest chunks): a **609 KiB** main/entry chunk + **158 KiB**
render-blocking CSS on every page; recharts (383 KiB) is correctly split into an
**admin-only** chunk (storefront visitors never load it).

### Perf backlog to reach LCP < 2.5 s (scoped follow-up)

Driving LCP from 4.5 s → 2.5 s is iterative bundle work that must be measured
per change; it was scoped here rather than rushed:

1. **Shrink/split the 609 KiB entry chunk** — the biggest lever. Manual vendor
   chunking + auditing what loads on the landing route (unused-JS is 241 KiB).
2. **Trim the 158 KiB CSS** and/or reduce its render-blocking cost.
3. **Self-host the two Google Fonts** to drop the third-party round-trip and make
   them non-render-blocking (preloaded, `font-display: swap`).
4. **Modern build target** to drop the ~11 KiB legacy-JS transpilation.

CLS (0) and TBT (200 ms) are already at/near target; the work is FCP/LCP payload.
