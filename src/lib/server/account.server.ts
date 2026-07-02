/**
 * Customer-account repository — SERVER ONLY.
 *
 * Thin service-role wrapper over the Stage-4 account RPCs (migration
 * 20260702081309). Every api.* account function is REVOKE-d from
 * anon/authenticated, so all calls go through the ADMIN client — by the time
 * we get here the server fn (account.api.ts) has already enforced CSRF +
 * a verified session + rate limit, and passes ONLY the verified user id
 * (the client never chooses the scope). Errors are re-thrown as AccountError
 * carrying a STABLE snake_case code (mapped from the RPC's RAISE EXCEPTION
 * message); raw SQL never reaches the client.
 */
import { createAdminSupabaseClient } from "./supabase-admin.server";
import {
  KNOWN_ACCOUNT_ERROR_CODES,
  mapAccountSnapshot,
  mapAddressRow,
  mapImportResult,
  mapMeasurementRow,
  mapProfileRow,
  mapWishlistCodes,
  mapWishlistToggle,
  toAddressPayload,
  toImportPayload,
  toMeasurementPayload,
  toProfilePatch,
  type AccountImportPayload,
  type AccountImportResult,
  type AccountProfileDto,
  type AccountSnapshot,
  type AddressInput,
  type MeasurementInput,
  type ProfilePatchInput,
  type ServerMeasurement,
  type ServerSavedAddress,
  type WishlistToggleResult,
} from "@/lib/account-shared";

export class AccountError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "AccountError";
  }
}

/** Map a Postgres/PostgREST error to a stable code (unknowns → internal_error). */
function throwAccountError(error: { message?: string }): never {
  const raw = (error.message ?? "").trim();
  throw new AccountError(KNOWN_ACCOUNT_ERROR_CODES.has(raw) ? raw : "internal_error");
}

export async function getMyAccount(userId: string): Promise<AccountSnapshot> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("get_my_account", { p_user: userId });
  if (error) throwAccountError(error);
  return mapAccountSnapshot(data);
}

export async function saveProfile(
  userId: string,
  patch: ProfilePatchInput,
): Promise<AccountProfileDto> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("save_profile", {
    p_user: userId,
    p_patch: toProfilePatch(patch),
  });
  if (error) throwAccountError(error);
  const profile = mapProfileRow(data);
  if (!profile) throw new AccountError("internal_error");
  return profile;
}

export async function upsertAddress(
  userId: string,
  input: AddressInput,
): Promise<ServerSavedAddress> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("upsert_address", {
    p_user: userId,
    p_id: input.id ?? null,
    p_address: toAddressPayload(input),
  });
  if (error) throwAccountError(error);
  const row = mapAddressRow(data);
  if (!row) throw new AccountError("internal_error");
  return row;
}

export async function deleteAddress(userId: string, id: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.schema("api").rpc("delete_address", {
    p_user: userId,
    p_id: id,
  });
  if (error) throwAccountError(error);
}

export async function setDefaultAddress(userId: string, id: string): Promise<ServerSavedAddress> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("set_default_address", {
    p_user: userId,
    p_id: id,
  });
  if (error) throwAccountError(error);
  const row = mapAddressRow(data);
  if (!row) throw new AccountError("internal_error");
  return row;
}

export async function upsertMeasurement(
  userId: string,
  input: MeasurementInput,
): Promise<ServerMeasurement> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("upsert_measurement", {
    p_user: userId,
    p_id: input.id ?? null,
    p_data: toMeasurementPayload(input),
  });
  if (error) throwAccountError(error);
  const row = mapMeasurementRow(data);
  if (!row) throw new AccountError("internal_error");
  return row;
}

export async function deleteMeasurement(userId: string, id: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.schema("api").rpc("delete_measurement", {
    p_user: userId,
    p_id: id,
  });
  if (error) throwAccountError(error);
}

/** Merge a device's local wishlist into the server (union, capped) — P6. */
export async function syncWishlist(userId: string, codes: string[]): Promise<string[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("sync_wishlist", {
    p_user: userId,
    p_codes: codes,
  });
  if (error) throwAccountError(error);
  return mapWishlistCodes(data);
}

/** Flip one wishlist heart; returns the new state + canonical list — P6. */
export async function toggleWishlist(userId: string, code: string): Promise<WishlistToggleResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("toggle_wishlist", {
    p_user: userId,
    p_code: code,
  });
  if (error) throwAccountError(error);
  return mapWishlistToggle(data);
}

export async function importAccountData(
  userId: string,
  payload: AccountImportPayload,
): Promise<AccountImportResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("import_account_data", {
    p_user: userId,
    p_payload: toImportPayload(payload),
  });
  if (error) throwAccountError(error);
  return mapImportResult(data);
}
