/**
 * Founder profile (CMS) repository — SERVER ONLY.
 *
 * Owner calls use the SERVICE-ROLE client because the api.*_founder_profile*
 * write RPCs are REVOKE-d from anon/authenticated; the server fn
 * (founder.api.ts) has already enforced CSRF + the owner-exclusive
 * `founder.manage` permission + MFA step-up + rate limit via guardAdminWrite.
 * The RPCs independently re-check `role = 'owner'` and write the canonical
 * founder.* audit rows. Errors are re-thrown as FounderAdminError with a STABLE
 * code; raw SQL never reaches the client.
 *
 * The public storefront read uses the per-request ANON client behind the shared
 * public TTL cache — same guarantee as the policy pages.
 */
import { createServerSupabaseClient } from "./supabase.server";
import { createAdminSupabaseClient } from "./supabase-admin.server";
import { cachedPublic } from "./public-cache.server";
import {
  KNOWN_FOUNDER_ERROR_CODES,
  toFounderContent,
  type AdminFounderProfile,
  type FounderContent,
  type FounderRevision,
} from "@/lib/founder-shared";

export class FounderAdminError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "FounderAdminError";
  }
}

function throwFounderError(error: { code?: string; message?: string }): never {
  const raw = (error.message ?? "").trim();
  if (error.code === "23514" || error.code === "23502")
    throw new FounderAdminError("invalid_content");
  throw new FounderAdminError(KNOWN_FOUNDER_ERROR_CODES.has(raw) ? raw : "internal_error");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Published founder content for the storefront. Null on failure or on a
 * document that no longer satisfies the schema → the route falls back to the
 * built-in copy rather than rendering a half-empty page.
 */
async function loadPublicFounderContent(): Promise<FounderContent | null> {
  const sb = createServerSupabaseClient();
  const { data, error } = await sb.schema("api").rpc("get_founder_profile");
  if (error || !isRecord(data)) return null;
  return toFounderContent(data.content);
}

const cachedFounderReader = cachedPublic(
  "public-founder-profile",
  60_000,
  loadPublicFounderContent,
);

export function fetchPublicFounderContent(): Promise<FounderContent | null> {
  return cachedFounderReader();
}

/** Full row incl. the draft working copy, for the owner editor. */
export async function getFounderProfileAdmin(actorId: string): Promise<AdminFounderProfile> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("get_founder_profile_admin", { p_actor: actorId });
  if (error) throwFounderError(error);
  return data as AdminFounderProfile;
}

/** Save/replace the draft working copy. */
export async function saveFounderDraft(content: FounderContent, actorId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .schema("api")
    .rpc("save_founder_profile_draft", { p_actor: actorId, p_content: content });
  if (error) throwFounderError(error);
}

/** Publish the draft (writes a revision, prunes to 20). */
export async function publishFounderProfile(actorId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.schema("api").rpc("publish_founder_profile", { p_actor: actorId });
  if (error) throwFounderError(error);
}

/** Drop the draft working copy. */
export async function discardFounderDraft(actorId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .schema("api")
    .rpc("discard_founder_profile_draft", { p_actor: actorId });
  if (error) throwFounderError(error);
}

/** Revision history (≤20, newest first). */
export async function listFounderRevisions(actorId: string): Promise<FounderRevision[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("list_founder_profile_revisions", { p_actor: actorId });
  if (error) throwFounderError(error);
  return (data ?? []) as FounderRevision[];
}

/** Load a revision into the draft (publish separately to go live). */
export async function restoreFounderRevision(revisionId: number, actorId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .schema("api")
    .rpc("restore_founder_profile_revision", { p_actor: actorId, p_revision_id: revisionId });
  if (error) throwFounderError(error);
}
