## Goal

Replace the rejected 404 illustration with a transparent, portrait, semi-realistic editorial asset whose laptop screen shows the real Nongorr logo and a deterministic "404 / Page not found" interface (text composited locally, not AI-generated).

## Steps

### 1. Remove the rejected asset

- Delete `src/assets/notfound-illustration.webp`.
- Remove its import from `src/components/NotFoundPage.tsx`.
- `rg notfound-illustration` to confirm zero remaining references.

### 2. Generate the new master illustration

- Premium image generator, `transparent_background: true`, portrait ~832×1024.
- Prompt: sophisticated semi-realistic editorial fashion illustration (~60–70% illustration / 30–40% realism); young adult woman seated naturally on a minimal cane/wooden chair beside a small side table; open laptop angled toward the viewer; one hand resting naturally near the keyboard/touchpad; modern Nongorr-style kurti (burgundy / muted gold / blush / cream), contemporary and wearable, not bridal; soft hand-painted texture, refined linework, simplified elegant features, natural proportions; soft floor shadow; no room background or clutter.
- Explicit negatives: not photographic, not anime, not 3D, not vector, not bridal.
- Laptop screen kept intentionally blank (plain cream with a thin burgundy bezel accent) — no AI-generated text or logo.
- Save master to `src/assets/notfound-illustration.png` with clean alpha.

### 3. Composite the real Nongorr screen onto the laptop

- Use Pillow in Python (already available in the sandbox; verify with an import smoke test).
- Build a screen layer at high resolution: cream fill, real `src/assets/nongorr-logo-transparent.png` placed in the top-left at correct proportions, large serif "404" centered, smaller "Page not found" beneath in burgundy, one restrained muted-gold underline accent. Use a bundled serif font (e.g. project font file if present, else a system serif fallback like DejaVu Serif).
- Detect the laptop screen quad in the generated illustration by sampling a small region the prompt reserves (lightest near-rectangular area inside the bezel). If reliable detection fails, fall back to manually tuned four-point coordinates after viewing the master.
- Perspective-transform the screen layer onto that quad with Pillow and alpha-composite, keeping all content inside the bezel.
- Re-save the composited result as the master PNG.

### 4. QA pass on the master

- View at 100% / 200% / 400%.
- Reject and regenerate (not edit) if any of: photoreal face, bridal outfit, extra/broken fingers, warped laptop, screen outside bezel, visible image rectangle, white halo, or transparency holes inside clothing/furniture.
- Verify alpha edges are clean around hair, kurti, chair, table and laptop.

### 5. Produce the optimized web asset

- Probe environment for an encoder in this order: `cwebp` (via nix), Pillow's WebP, ImageMagick.
- Encode `src/assets/notfound-illustration.webp` as transparent WebP at q≈85, adjust if edges or screen text degrade.
- Report PNG vs WebP dimensions and bytes. Serve WebP if alpha and screen text remain clean; otherwise serve the optimized PNG.

### 6. Integrate into `NotFoundPage.tsx`

- Import the chosen served asset.
- Replace the current `<img>` block with:
  ```tsx
  <div className="mx-auto aspect-[4/5] w-full max-w-[420px]">
    <img
      src={notFoundIllustration}
      alt=""
      aria-hidden="true"
      width={832}
      height={1024}
      decoding="async"
      draggable={false}
      className="h-full w-full object-contain"
    />
  </div>
  ```
- Eager-load (no `loading="lazy"`); add `fetchPriority="high"` only if needed.
- Keep existing `lg:col-span-5` placement, `animate-scale-in`, and responsive structure. No new animations.

### 7. Preserve the rest of the page

- Header, cream background, 404 heading, "This page has drifted away.", description, both buttons, supporting links, routing, metadata, and existing animations remain unchanged.

### 8. Verify

- Navigate to `/some-unknown-url` and `/product/invalid-slug`: no rectangular image background, illustration blends into cream, kurti reads modern not bridal, laptop "404" readable at desktop size, Nongorr logo recognizable, heading still dominates the left column, no layout shift or overflow, no console errors.
- Run the existing Vitest suite; do not touch tests unless a real regression appears.

### 9. Final report

- List asset filenames, PNG/WebP dimensions and byte sizes, which file is served and why, confirmation the laptop UI uses the real Nongorr logo via deterministic compositing, and confirmation that no routing, backend, API, database, auth, payment, or courier functionality was changed.

## Technical notes

- Compositing runs in `/tmp` via a Python script using Pillow; only the final PNG and WebP are written to `src/assets/`.
- No new npm dependencies. No changes to router, route metadata, or tests.
- If multiple generation attempts fail QA, fall back to a slightly simpler scene (chair + laptop on lap) rather than altering brand copy or page layout.
