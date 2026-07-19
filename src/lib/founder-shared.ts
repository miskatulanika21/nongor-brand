/**
 * Founder profile (CMS) — isomorphic types, input schema, icon registry, error
 * copy and the built-in fallback content shared by the storefront route, the
 * admin editor and the server fns. NO server-only imports (client-bundle safe).
 *
 * Mirrors the Stage-7 RPCs (api.get_founder_profile / get_founder_profile_admin
 * / save_founder_profile_draft / publish_founder_profile /
 * discard_founder_profile_draft / list_founder_profile_revisions /
 * restore_founder_profile_revision) and `founder_profile`.
 *
 * Unlike the markdown policy CMS (pages-shared.ts), the founder page is a
 * DESIGNED layout: the DB stores a structured content document and the route
 * renders fixed sections from it, so an owner edit can never break the design.
 */
import { z } from "zod";

/** The single row's primary key (DB CHECK mirrors this). */
export const FOUNDER_SLUG = "founder";

// ── Icon registry ────────────────────────────────────────────────────────────
// Admins pick from this closed set; the route maps keys → lucide components.
// A free-text icon field would let a typo render nothing, so it stays an enum.

export const FOUNDER_ICON_KEYS = [
  "sparkles",
  "anchor",
  "scissors",
  "ruler",
  "compass",
  "handHeart",
  "shield",
  "gem",
  "heart",
  "hammer",
  "handshake",
  "sprout",
  "flower",
  "package",
] as const;

export type FounderIconKey = (typeof FOUNDER_ICON_KEYS)[number];

/** Human labels for the admin icon picker. */
export const FOUNDER_ICON_LABELS: Record<FounderIconKey, string> = {
  sparkles: "Sparkles",
  anchor: "Anchor",
  scissors: "Scissors",
  ruler: "Ruler",
  compass: "Compass",
  handHeart: "Hand & heart",
  shield: "Shield",
  gem: "Gem",
  heart: "Heart",
  hammer: "Hammer",
  handshake: "Handshake",
  sprout: "Sprout",
  flower: "Flower",
  package: "Package",
};

export function isFounderIconKey(value: unknown): value is FounderIconKey {
  return typeof value === "string" && (FOUNDER_ICON_KEYS as readonly string[]).includes(value);
}

// ── Content schema ───────────────────────────────────────────────────────────

const text = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label} is required.`).max(max, `${label} is too long.`);

const optionalUrl = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(600).nullable(),
  )
  .nullable()
  .default(null);

const iconKey = z.enum(FOUNDER_ICON_KEYS);

export const founderContentSchema = z.object({
  /** Identity — also drives the page <h1>, SEO and Person JSON-LD. */
  name: text(1, 120, "Founder name"),
  role: text(1, 160, "Role"),
  eyebrow: text(1, 80, "Eyebrow"),

  seo: z.object({
    title: text(1, 160, "SEO title"),
    description: text(1, 300, "SEO description"),
  }),

  hero: z.object({
    intro: text(1, 1200, "Hero introduction"),
    portraitUrl: optionalUrl,
    portraitAlt: text(1, 240, "Portrait alt text"),
    stats: z
      .array(z.object({ label: text(1, 40, "Stat label"), value: text(1, 40, "Stat value") }))
      .max(4, "Up to 4 stats.")
      .default([]),
  }),

  letter: z.object({
    eyebrow: text(1, 80, "Letter eyebrow"),
    title: text(1, 160, "Letter title"),
    paragraphs: z
      .array(text(1, 2000, "Letter paragraph"))
      .min(1, "The letter needs at least one paragraph.")
      .max(8, "Up to 8 paragraphs."),
  }),

  philosophy: z.object({
    eyebrow: text(1, 80, "Philosophy eyebrow"),
    title: text(1, 160, "Philosophy title"),
    items: z
      .array(
        z.object({
          icon: iconKey,
          title: text(1, 80, "Principle title"),
          body: text(1, 600, "Principle body"),
        }),
      )
      .max(6, "Up to 6 principles.")
      .default([]),
  }),

  journey: z.object({
    eyebrow: text(1, 80, "Journey eyebrow"),
    title: text(1, 160, "Journey title"),
    items: z
      .array(
        z.object({
          icon: iconKey,
          chapter: text(1, 60, "Chapter label"),
          title: text(1, 120, "Chapter title"),
          body: text(1, 1000, "Chapter body"),
        }),
      )
      .max(8, "Up to 8 chapters.")
      .default([]),
  }),

  craft: z.object({
    eyebrow: text(1, 80, "Craft eyebrow"),
    title: text(1, 160, "Craft title"),
    body: text(1, 1200, "Craft body"),
    imageUrl: optionalUrl,
    imageAlt: text(1, 240, "Craft image alt text"),
    imageCaption: text(1, 240, "Craft image caption"),
    details: z
      .array(text(1, 160, "Detail"))
      .max(10, "Up to 10 details.")
      .default([]),
  }),

  quote: z.object({
    text: text(1, 400, "Quote"),
    attribution: text(1, 120, "Quote attribution"),
  }),

  connect: z.object({
    eyebrow: text(1, 80, "Connect eyebrow"),
    title: text(1, 160, "Connect title"),
    body: text(1, 600, "Connect body"),
    whatsappMessage: text(1, 300, "WhatsApp message"),
    /**
     * The founder's PERSONAL profiles. Unset falls back to the brand accounts
     * in BRAND, so the social row is never empty.
     */
    facebookUrl: optionalUrl,
    instagramUrl: optionalUrl,
  }),
});

export type FounderContent = z.infer<typeof founderContentSchema>;

/** Draft save input (the whole document — the editor always submits it all). */
export const founderDraftSchema = z.object({ content: founderContentSchema });
export type FounderDraftInput = z.infer<typeof founderDraftSchema>;

export const founderRevisionArgSchema = z.object({
  revisionId: z.coerce.number().int().positive(),
});

// ── Admin payload shapes (mirror the RPCs) ───────────────────────────────────

export interface AdminFounderProfile {
  slug: string;
  content: FounderContent;
  draft: FounderContent | null;
  published_at: string;
  updated_at: string;
}

export interface FounderRevision {
  id: number;
  content: FounderContent;
  published_at: string;
  published_by_email: string | null;
}

// ── Error copy (stable snake_case codes from the RPCs) ───────────────────────

export const FOUNDER_ERROR_MESSAGES: Record<string, string> = {
  actor_not_authorized: "Not authorized.",
  profile_not_found: "The founder profile row is missing.",
  revision_not_found: "That revision no longer exists.",
  no_draft_to_publish: "There is no draft to publish — save your changes first.",
  invalid_content: "Some values are out of bounds. Check the fields and try again.",
  internal_error: "Could not save the founder page. Please try again.",
};

export const KNOWN_FOUNDER_ERROR_CODES = new Set(Object.keys(FOUNDER_ERROR_MESSAGES));

export function founderErrorMessage(code: string | null | undefined): string {
  if (!code) return FOUNDER_ERROR_MESSAGES.internal_error;
  return FOUNDER_ERROR_MESSAGES[code] ?? FOUNDER_ERROR_MESSAGES.internal_error;
}

// ── Payload coercion ─────────────────────────────────────────────────────────

/**
 * Parse an untrusted content payload (DB read / revision) into FounderContent.
 * Returns null when the document does not satisfy the schema, so every caller
 * can fall back to FOUNDER_FALLBACK rather than render a half-empty page.
 */
export function toFounderContent(raw: unknown): FounderContent | null {
  const parsed = founderContentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ── Built-in fallback ────────────────────────────────────────────────────────

/**
 * The shipped copy. Seeded into the DB by the migration and used verbatim when
 * the public read fails (network/DB blip) so /founder is never blank. Image URLs
 * are null here: the route substitutes the bundled portrait/lifestyle assets,
 * which cannot be referenced by URL from this isomorphic module.
 */
export const FOUNDER_FALLBACK: FounderContent = {
  name: "Miskatul Afrin Anika",
  role: "Founder & Creative Lead of Nongorr",
  eyebrow: "The Woman Behind Nongorr",
  seo: {
    title: "Miskatul Afrin Anika · Founder of Nongorr",
    description:
      "Miskatul Afrin Anika founded Nongorr to keep Bengali nakshi kantha craftsmanship in use. From Sreenagar in Munshiganj, she runs the boutique while completing a BSc in Computer Science and Engineering at BRAC University.",
  },
  hero: {
    intro:
      "Anika is from Sreenagar, in Munshiganj, and is currently an undergraduate at BRAC University, reading for a Bachelor of Science in Computer Science and Engineering. Nongorr began with something far older than either: the nakshi kantha. For generations, Bengali women layered worn sarees and stitched them, evening after evening, into quilts that carried whole stories. One could take months. That patience is quietly going out of use. She started Nongorr because she did not want to stand by and watch it go.",
    portraitUrl: null,
    portraitAlt: "Miskatul Afrin Anika, founder of Nongorr, in a maroon and gold saree",
    stats: [
      { label: "Hometown", value: "Sreenagar, Munshiganj" },
      { label: "Studying", value: "CSE at BRAC University" },
      { label: "Signature", value: "Custom fit" },
    ],
  },
  letter: {
    eyebrow: "In Her Words",
    title: "A Letter to the Woman Wearing Nongorr",
    paragraphs: [
      "The reason Nongorr exists is a quilt. For generations, women across Bengal took sarees too worn to wear, layered three to seven of them, and joined them with a simple running stitch. Nakshi kantha, we call it: naksha for the design, kantha for the quilt. Even the thread was pulled from the coloured borders of the sarees themselves. Nothing was wasted, and nothing was hurried.",
      "What they stitched was never only decoration. Lotus and vine, elephants, boats, peacocks, palanquins, the ordinary vessels of a kitchen. Women who were never taught to write put their lives down in thread, and some signed their names at the edge of the cloth where a painter would sign a canvas. A medium kantha still takes two or three months of evenings. Jasimuddin wrote a poem about that field of embroidery in 1929 and this country has been reciting it ever since.",
      "It is fading now. Not dramatically, just quietly, the way any skill goes when it passes from mother to daughter and one generation stops asking to be taught. We have learned to buy clothes built for a single season, made far away from anyone who will ever wear them, and we call that progress. I could not accept that something so patient should disappear simply because nothing modern was built to carry it.",
      "I grew up in Sreenagar, in Munshiganj — the old Bikrampur, capital of Bengal for three centuries before Dhaka was anything at all. You are raised there with the sense that the important things came from here first. It is difficult to carry that and then watch our own crafts treated as though they were behind the times.",
      "So Nongorr is my attempt to carry it forward. Not by copying something out of a museum, but by keeping what made the work worth doing: handwork given the time it actually needs, cloth cut for the specific woman who will wear it, and a garment made to be kept rather than replaced. I am also finishing a Computer Science and Engineering degree at BRAC University, which surprises people. It should not. Software and clothing ask the same question — does this work for the person who has to live with it? Most ready-made clothing does not. It fits the size chart, not her.",
      "Nongorr is still small, so nearly all of this passes through my hands. If you message us, you are speaking to someone who knows the piece you are asking about. Thank you for trusting us with something as personal as what you wear, and for helping keep an old stitch in use.",
    ],
  },
  philosophy: {
    eyebrow: "What She Believes",
    title: "The Principles Behind Every Piece",
    items: [
      {
        icon: "handHeart",
        title: "Keep the craft in use",
        body: "A tradition survives by being worn, not by being admired in a museum. Handwork stays in even when it slows an order down.",
      },
      {
        icon: "ruler",
        title: "Fit is respect",
        body: "Sending your measurements should change what arrives at your door. If it does not, the option is just decoration.",
      },
      {
        icon: "sparkles",
        title: "Made to be kept",
        body: "The kantha was built to outlast the woman who stitched it. Nothing here is designed to be worn once and replaced next season.",
      },
      {
        icon: "shield",
        title: "Straight answers",
        body: "Honest delivery estimates, real replies on WhatsApp, and a clear explanation when something goes wrong.",
      },
    ],
  },
  journey: {
    eyebrow: "The Journey",
    title: "From a Single Idea to a Boutique",
    items: [
      {
        icon: "handHeart",
        chapter: "Nakshi kantha",
        title: "The craft that started it",
        body: "Worn sarees, layered three to seven deep and joined with a running stitch, the thread drawn from the sarees' own borders. Lotus, elephant, boat, peacock. A medium kantha takes two or three months of evenings, and around three hundred thousand people in Bangladesh still work in the craft — almost all of them women. Fewer families teach it each year. Nongorr exists because Anika did not want to watch that happen quietly.",
      },
      {
        icon: "anchor",
        chapter: "Sreenagar, Munshiganj",
        title: "Raised in the old capital",
        body: "Her home district is ancient Bikrampur: the seat of the Chandra, Varman and Sena rulers from the tenth century to the middle of the thirteenth, the centre of Bengal long before Dhaka mattered. Atish Dipankar left here for Tibet in 1042. Jagadish Chandra Bose was born a few villages over. Growing up among that makes it harder to accept our own crafts being treated as though they were behind the times.",
      },
      {
        icon: "compass",
        chapter: "BRAC University",
        title: "A degree and a boutique",
        body: "Nongorr was built alongside a Bachelor of Science in Computer Science and Engineering, which she is still completing. Running both at once enforces its own discipline: every process here has to be simple enough to survive exam season.",
      },
      {
        icon: "anchor",
        chapter: "The name",
        title: "Choosing the anchor",
        body: "Nongorr comes from নোঙর, the Bengali word for anchor. It was chosen deliberately: it stands for steadiness and for belonging somewhere. The maroon fabric beside it is a nod to Bangladeshi women's wear. The identity was settled before a single piece had sold.",
      },
      {
        icon: "scissors",
        chapter: "The first piece",
        title: "One kurti, done properly",
        body: "The first kurti took far longer than it needed to. Fabric, fall, finishing, the inside of the seams. Every piece since has been measured against it.",
      },
      {
        icon: "ruler",
        chapter: "Custom fit",
        title: "Measurements over size charts",
        body: "Standard sizes were never going to cover it. Custom measurements became part of how the boutique works, so that ordering online can come closer to visiting a tailor.",
      },
      {
        icon: "sprout",
        chapter: "What comes next",
        title: "Beyond kurti",
        body: "Kurti today, with saree, three piece, girls dress and beauty products planned. The aim is one place worth trusting, widened carefully rather than quickly.",
      },
    ],
  },
  craft: {
    eyebrow: "Her Craft",
    title: "What She Looks for in Every Piece",
    body: "Anika looks over pieces before they are listed and again before they are packed. The boutique is small enough that this is genuinely one person checking the work, not a policy written on a page. What she looks for is unglamorous and specific: whether the fabric suits the weather here, whether the handwork is even, whether the seams will survive being worn properly rather than carefully. The standard is the one the kantha set — work meant to outlast the person who made it.",
    imageUrl: null,
    imageAlt: "Anika in a maroon outfit on a flower-decorated garden swing at golden hour",
    imageCaption: "Colour and craft, chosen the way she would choose them for herself.",
    details: [
      "Fabric that holds up in Bangladeshi heat",
      "Traditional motifs kept recognisable, not flattened",
      "Handwork and embroidery checked piece by piece",
      "Seams and finishing inspected before dispatch",
      "Your measurements cut exactly as sent",
      "A palette built around maroon, gold and ivory",
      "Packed properly, because it often arrives as a gift",
    ],
  },
  quote: {
    text: "Every piece should feel thoughtful — not just worn, but loved.",
    attribution: "Miskatul Afrin Anika",
  },
  connect: {
    eyebrow: "Say Hello",
    title: "Talk to the Founder",
    body: "Questions about fit, fabric, or something you have in mind? Messages here reach the small team behind Nongorr, and often Anika herself.",
    whatsappMessage: "Hello Nongorr! I just read Anika's story and I would like to know more.",
    facebookUrl: "https://www.facebook.com/miskatul.anika",
    instagramUrl: "https://www.instagram.com/annika___chan/",
  },
};
