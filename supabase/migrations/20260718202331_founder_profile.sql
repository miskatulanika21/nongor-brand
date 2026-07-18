-- Stage 7 — Founder profile CMS (founder_profile).
--
-- The storefront gained a dedicated /founder page. Its copy is brand-critical
-- and personal, so the owner must be able to edit it without a deploy. This
-- follows the Stage-6 site_pages pattern (draft working copy → publish with
-- pruned revision history → restore) but stores a STRUCTURED jsonb document
-- instead of markdown: the route renders fixed, designed sections from it, so
-- an edit can change words and images but never break the layout.
--
-- Posture: RPC-only deny-all (site_pages/banners pattern). Public read is
-- anon-granted and returns the published document only. Writes are service-role
-- only AND owner-only — this is identity/brand-voice content, so the SQL side
-- re-checks `role = 'owner'` rather than merely "active staff" (the app also
-- gates the new owner-exclusive `founder.manage` permission). Canonical
-- founder.* audit rows are written SQL-side.
--
-- Single row: slug = 'founder' (CHECK-pinned), seeded with the shipped copy.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Structural validation — defence in depth behind the zod schema
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.founder_content_is_valid(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- COALESCE(..., false) is load-bearing: a missing key makes `p->'x'` NULL, so
  -- an unwrapped AND-chain would evaluate to NULL — and a CHECK constraint
  -- treats NULL as PASSING. Without this, a document missing whole sections
  -- would be accepted.
  SELECT COALESCE(
    jsonb_typeof(p) = 'object'
    -- required scalars
    AND coalesce(char_length(btrim(p->>'name')), 0) BETWEEN 1 AND 120
    AND coalesce(char_length(btrim(p->>'role')), 0) BETWEEN 1 AND 160
    AND coalesce(char_length(btrim(p->>'eyebrow')), 0) BETWEEN 1 AND 80
    -- required objects
    AND jsonb_typeof(p->'seo') = 'object'
    AND jsonb_typeof(p->'hero') = 'object'
    AND jsonb_typeof(p->'letter') = 'object'
    AND jsonb_typeof(p->'philosophy') = 'object'
    AND jsonb_typeof(p->'journey') = 'object'
    AND jsonb_typeof(p->'craft') = 'object'
    AND jsonb_typeof(p->'quote') = 'object'
    AND jsonb_typeof(p->'connect') = 'object'
    -- required arrays, capped to keep the designed layout intact
    AND jsonb_typeof(p->'hero'->'stats') = 'array'
    AND jsonb_array_length(p->'hero'->'stats') <= 4
    AND jsonb_typeof(p->'letter'->'paragraphs') = 'array'
    AND jsonb_array_length(p->'letter'->'paragraphs') BETWEEN 1 AND 8
    AND jsonb_typeof(p->'philosophy'->'items') = 'array'
    AND jsonb_array_length(p->'philosophy'->'items') <= 6
    AND jsonb_typeof(p->'journey'->'items') = 'array'
    AND jsonb_array_length(p->'journey'->'items') <= 8
    AND jsonb_typeof(p->'craft'->'details') = 'array'
    AND jsonb_array_length(p->'craft'->'details') <= 10
    -- total document size guard
    AND octet_length(p::text) <= 60000,
  false);
$$;

COMMENT ON FUNCTION public.founder_content_is_valid(jsonb) IS
  'Structural sanity check for founder_profile documents. Defence in depth: the server fn validates the full zod schema before the RPC is ever called.';

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. founder_profile — the single published row + its draft working copy
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.founder_profile (
  slug         text        PRIMARY KEY CHECK (slug = 'founder'),
  content      jsonb       NOT NULL CHECK (public.founder_content_is_valid(content)),
  -- unpublished working copy: same shape as `content`, or NULL
  draft        jsonb       CHECK (draft IS NULL OR public.founder_content_is_valid(draft)),
  published_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.founder_profile IS
  'Structured, owner-editable content document for the /founder storefront page. RPC-only (deny-all RLS). Public read via api.get_founder_profile; owner-only draft/publish/restore via api.*_founder_profile* (app gates founder.manage, an owner-exclusive permission).';

ALTER TABLE public.founder_profile ENABLE ROW LEVEL SECURITY;
-- deny-all: no policies. Only service-role RPCs read/write.

REVOKE ALL ON TABLE public.founder_profile FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.founder_profile TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. founder_profile_revisions — one row per publish, pruned to the latest 20
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.founder_profile_revisions (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug         text        NOT NULL REFERENCES public.founder_profile(slug) ON DELETE CASCADE,
  content      jsonb       NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.founder_profile_revisions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_founder_profile_revisions_slug
  ON public.founder_profile_revisions (slug, id DESC);

REVOKE ALL ON TABLE public.founder_profile_revisions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.founder_profile_revisions TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Owner guard — shared by every write RPC below
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION private.require_founder_owner(p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles
    WHERE user_id = p_actor
      AND is_active
      AND role = 'owner'::private.staff_role
  ) THEN
    RAISE EXCEPTION 'actor_not_authorized';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.require_founder_owner(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.require_founder_owner(uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. get_founder_profile — public storefront read (published document only)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.get_founder_profile()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'slug', f.slug,
    'content', f.content,
    'published_at', f.published_at)
  FROM public.founder_profile f
  WHERE f.slug = 'founder';
$$;

REVOKE ALL ON FUNCTION api.get_founder_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_founder_profile() TO anon, authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. get_founder_profile_admin — full row incl. draft for the editor
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.get_founder_profile_admin(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v jsonb;
BEGIN
  PERFORM private.require_founder_owner(p_actor);

  SELECT to_jsonb(f) INTO v FROM public.founder_profile f WHERE f.slug = 'founder';
  IF v IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION api.get_founder_profile_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.get_founder_profile_admin(uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. save_founder_profile_draft — store/replace the working copy + audit
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.save_founder_profile_draft(p_actor uuid, p_content jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_founder_owner(p_actor);

  IF NOT public.founder_content_is_valid(p_content) THEN
    RAISE EXCEPTION 'invalid_content';
  END IF;

  UPDATE public.founder_profile SET
    draft      = p_content,
    updated_at = now(),
    updated_by = p_actor
  WHERE slug = 'founder';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'founder.draft_saved', 'founder_profile', 'founder',
    jsonb_build_object('name', p_content->>'name'));

  RETURN jsonb_build_object('slug', 'founder', 'has_draft', true);
EXCEPTION
  WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'invalid_content';
END;
$$;

REVOKE ALL ON FUNCTION api.save_founder_profile_draft(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.save_founder_profile_draft(uuid, jsonb) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 8. publish_founder_profile — draft → live + revision (pruned to 20) + audit
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.publish_founder_profile(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_row public.founder_profile%ROWTYPE;
BEGIN
  PERFORM private.require_founder_owner(p_actor);

  SELECT * INTO v_row FROM public.founder_profile WHERE slug = 'founder' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;
  IF v_row.draft IS NULL THEN
    RAISE EXCEPTION 'no_draft_to_publish';
  END IF;

  UPDATE public.founder_profile SET
    content      = v_row.draft,
    draft        = NULL,
    published_at = now(),
    updated_at   = now(),
    updated_by   = p_actor
  WHERE slug = 'founder'
  RETURNING * INTO v_row;

  INSERT INTO public.founder_profile_revisions (slug, content, published_by)
  VALUES ('founder', v_row.content, p_actor);

  -- Keep the latest 20 revisions.
  DELETE FROM public.founder_profile_revisions
  WHERE slug = 'founder'
    AND id NOT IN (
      SELECT id FROM public.founder_profile_revisions
      WHERE slug = 'founder' ORDER BY id DESC LIMIT 20);

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'founder.published', 'founder_profile', 'founder',
    jsonb_build_object('name', v_row.content->>'name'));

  RETURN jsonb_build_object('slug', 'founder', 'published_at', v_row.published_at);
EXCEPTION
  WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'invalid_content';
END;
$$;

REVOKE ALL ON FUNCTION api.publish_founder_profile(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.publish_founder_profile(uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9. discard_founder_profile_draft — drop the working copy + audit
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.discard_founder_profile_draft(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_founder_owner(p_actor);

  UPDATE public.founder_profile SET
    draft = NULL, updated_at = now(), updated_by = p_actor
  WHERE slug = 'founder';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'founder.draft_discarded', 'founder_profile', 'founder', '{}'::jsonb);

  RETURN jsonb_build_object('slug', 'founder', 'has_draft', false);
END;
$$;

REVOKE ALL ON FUNCTION api.discard_founder_profile_draft(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.discard_founder_profile_draft(uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 10. list_founder_profile_revisions — history for the editor (≤20 rows)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.list_founder_profile_revisions(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_rows jsonb;
BEGIN
  PERFORM private.require_founder_owner(p_actor);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'content', r.content,
    'published_at', r.published_at, 'published_by_email', u.email
  ) ORDER BY r.id DESC), '[]'::jsonb) INTO v_rows
  FROM public.founder_profile_revisions r
  LEFT JOIN auth.users u ON u.id = r.published_by
  WHERE r.slug = 'founder';

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION api.list_founder_profile_revisions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_founder_profile_revisions(uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 11. restore_founder_profile_revision — revision → draft (never straight live)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION api.restore_founder_profile_revision(p_actor uuid, p_revision_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_rev public.founder_profile_revisions%ROWTYPE;
BEGIN
  PERFORM private.require_founder_owner(p_actor);

  SELECT * INTO v_rev FROM public.founder_profile_revisions
  WHERE id = p_revision_id AND slug = 'founder';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revision_not_found';
  END IF;

  UPDATE public.founder_profile SET
    draft = v_rev.content, updated_at = now(), updated_by = p_actor
  WHERE slug = 'founder';

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (p_actor, 'founder.draft_saved', 'founder_profile', 'founder',
    jsonb_build_object('restored_from_revision', p_revision_id));

  RETURN jsonb_build_object('slug', 'founder', 'has_draft', true);
END;
$$;

REVOKE ALL ON FUNCTION api.restore_founder_profile_revision(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.restore_founder_profile_revision(uuid, bigint) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 12. Seed — the shipped copy (mirrors FOUNDER_FALLBACK in founder-shared.ts)
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.founder_profile (slug, content)
VALUES ('founder', $json$
{
  "name": "Miskatul Afrin Anika",
  "role": "Founder & Creative Lead of Nongorr",
  "eyebrow": "The Woman Behind Nongorr",
  "seo": {
    "title": "Miskatul Afrin Anika · Founder of Nongorr",
    "description": "Miskatul Afrin Anika founded Nongorr to keep Bengali nakshi kantha craftsmanship in use. From Sreenagar in Munshiganj, she runs the boutique while completing a BSc in Computer Science and Engineering at BRAC University."
  },
  "hero": {
    "intro": "Anika is from Sreenagar, in Munshiganj, and is currently an undergraduate at BRAC University, reading for a Bachelor of Science in Computer Science and Engineering. Nongorr began with something far older than either: the nakshi kantha. For generations, Bengali women layered worn sarees and stitched them, evening after evening, into quilts that carried whole stories. One could take months. That patience is quietly going out of use. She started Nongorr because she did not want to stand by and watch it go.",
    "portraitUrl": null,
    "portraitAlt": "Miskatul Afrin Anika, founder of Nongorr, in a maroon and gold saree",
    "stats": [
      {
        "label": "Hometown",
        "value": "Sreenagar, Munshiganj"
      },
      {
        "label": "Studying",
        "value": "CSE at BRAC University"
      },
      {
        "label": "Signature",
        "value": "Custom fit"
      }
    ]
  },
  "letter": {
    "eyebrow": "In Her Words",
    "title": "A Letter to the Woman Wearing Nongorr",
    "paragraphs": [
      "The reason Nongorr exists is a quilt. For generations, women across Bengal took sarees too worn to wear, layered three to seven of them, and joined them with a simple running stitch. Nakshi kantha, we call it: naksha for the design, kantha for the quilt. Even the thread was pulled from the coloured borders of the sarees themselves. Nothing was wasted, and nothing was hurried.",
      "What they stitched was never only decoration. Lotus and vine, elephants, boats, peacocks, palanquins, the ordinary vessels of a kitchen. Women who were never taught to write put their lives down in thread, and some signed their names at the edge of the cloth where a painter would sign a canvas. A medium kantha still takes two or three months of evenings. Jasimuddin wrote a poem about that field of embroidery in 1929 and this country has been reciting it ever since.",
      "It is fading now. Not dramatically, just quietly, the way any skill goes when it passes from mother to daughter and one generation stops asking to be taught. We have learned to buy clothes built for a single season, made far away from anyone who will ever wear them, and we call that progress. I could not accept that something so patient should disappear simply because nothing modern was built to carry it.",
      "I grew up in Sreenagar, in Munshiganj — the old Bikrampur, capital of Bengal for three centuries before Dhaka was anything at all. You are raised there with the sense that the important things came from here first. It is difficult to carry that and then watch our own crafts treated as though they were behind the times.",
      "So Nongorr is my attempt to carry it forward. Not by copying something out of a museum, but by keeping what made the work worth doing: handwork given the time it actually needs, cloth cut for the specific woman who will wear it, and a garment made to be kept rather than replaced. I am also finishing a Computer Science and Engineering degree at BRAC University, which surprises people. It should not. Software and clothing ask the same question — does this work for the person who has to live with it? Most ready-made clothing does not. It fits the size chart, not her.",
      "Nongorr is still small, so nearly all of this passes through my hands. If you message us, you are speaking to someone who knows the piece you are asking about. Thank you for trusting us with something as personal as what you wear, and for helping keep an old stitch in use."
    ]
  },
  "philosophy": {
    "eyebrow": "What She Believes",
    "title": "The Principles Behind Every Piece",
    "items": [
      {
        "icon": "handHeart",
        "title": "Keep the craft in use",
        "body": "A tradition survives by being worn, not by being admired in a museum. Handwork stays in even when it slows an order down."
      },
      {
        "icon": "ruler",
        "title": "Fit is respect",
        "body": "Sending your measurements should change what arrives at your door. If it does not, the option is just decoration."
      },
      {
        "icon": "sparkles",
        "title": "Made to be kept",
        "body": "The kantha was built to outlast the woman who stitched it. Nothing here is designed to be worn once and replaced next season."
      },
      {
        "icon": "shield",
        "title": "Straight answers",
        "body": "Honest delivery estimates, real replies on WhatsApp, and a clear explanation when something goes wrong."
      }
    ]
  },
  "journey": {
    "eyebrow": "The Journey",
    "title": "From a Single Idea to a Boutique",
    "items": [
      {
        "icon": "handHeart",
        "chapter": "Nakshi kantha",
        "title": "The craft that started it",
        "body": "Worn sarees, layered three to seven deep and joined with a running stitch, the thread drawn from the sarees' own borders. Lotus, elephant, boat, peacock. A medium kantha takes two or three months of evenings, and around three hundred thousand people in Bangladesh still work in the craft — almost all of them women. Fewer families teach it each year. Nongorr exists because Anika did not want to watch that happen quietly."
      },
      {
        "icon": "anchor",
        "chapter": "Sreenagar, Munshiganj",
        "title": "Raised in the old capital",
        "body": "Her home district is ancient Bikrampur: the seat of the Chandra, Varman and Sena rulers from the tenth century to the middle of the thirteenth, the centre of Bengal long before Dhaka mattered. Atish Dipankar left here for Tibet in 1042. Jagadish Chandra Bose was born a few villages over. Growing up among that makes it harder to accept our own crafts being treated as though they were behind the times."
      },
      {
        "icon": "compass",
        "chapter": "BRAC University",
        "title": "A degree and a boutique",
        "body": "Nongorr was built alongside a Bachelor of Science in Computer Science and Engineering, which she is still completing. Running both at once enforces its own discipline: every process here has to be simple enough to survive exam season."
      },
      {
        "icon": "anchor",
        "chapter": "The name",
        "title": "Choosing the anchor",
        "body": "The anchor in the emblem was chosen deliberately. It stands for steadiness and for belonging somewhere. The maroon fabric beside it is a nod to Bangladeshi women's wear. The identity was settled before a single piece had sold."
      },
      {
        "icon": "scissors",
        "chapter": "The first piece",
        "title": "One kurti, done properly",
        "body": "The first kurti took far longer than it needed to. Fabric, fall, finishing, the inside of the seams. Every piece since has been measured against it."
      },
      {
        "icon": "ruler",
        "chapter": "Custom fit",
        "title": "Measurements over size charts",
        "body": "Standard sizes were never going to cover it. Custom measurements became part of how the boutique works, so that ordering online can come closer to visiting a tailor."
      },
      {
        "icon": "sprout",
        "chapter": "What comes next",
        "title": "Beyond kurti",
        "body": "Kurti today, with saree, three piece, girls dress and beauty products planned. The aim is one place worth trusting, widened carefully rather than quickly."
      }
    ]
  },
  "craft": {
    "eyebrow": "Her Craft",
    "title": "What She Looks for in Every Piece",
    "body": "Anika looks over pieces before they are listed and again before they are packed. The boutique is small enough that this is genuinely one person checking the work, not a policy written on a page. What she looks for is unglamorous and specific: whether the fabric suits the weather here, whether the handwork is even, whether the seams will survive being worn properly rather than carefully. The standard is the one the kantha set — work meant to outlast the person who made it.",
    "imageUrl": null,
    "imageAlt": "Anika in a maroon outfit on a flower-decorated garden swing at golden hour",
    "imageCaption": "Colour and craft, chosen the way she would choose them for herself.",
    "details": [
      "Fabric that holds up in Bangladeshi heat",
      "Traditional motifs kept recognisable, not flattened",
      "Handwork and embroidery checked piece by piece",
      "Seams and finishing inspected before dispatch",
      "Your measurements cut exactly as sent",
      "A palette built around maroon, gold and ivory",
      "Packed properly, because it often arrives as a gift"
    ]
  },
  "quote": {
    "text": "Every piece should feel thoughtful — not just worn, but loved.",
    "attribution": "Miskatul Afrin Anika"
  },
  "connect": {
    "eyebrow": "Say Hello",
    "title": "Talk to the Founder",
    "body": "Questions about fit, fabric, or something you have in mind? Messages here reach the small team behind Nongorr, and often Anika herself.",
    "whatsappMessage": "Hello Nongorr! I just read Anika's story and I would like to know more.",
    "facebookUrl": "https://www.facebook.com/miskatul.anika",
    "instagramUrl": "https://www.instagram.com/annika___chan/"
  }
}
$json$::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- Initial revision (idempotent: only when none exists yet).
INSERT INTO public.founder_profile_revisions (slug, content)
SELECT f.slug, f.content
FROM public.founder_profile f
WHERE NOT EXISTS (SELECT 1 FROM public.founder_profile_revisions r WHERE r.slug = f.slug);
