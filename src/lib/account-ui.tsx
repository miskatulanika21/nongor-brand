// ============================================================================
// Account UI — server-backed provider (Stage 4 P4).
// State is seeded from the /account route loader (api.get_my_account via
// getMyAccountFn) and every mutation flows through the guarded server fns in
// account.api.ts. Mutations are optimistic with rollback; failures surface the
// server's stable-code message as a toast, so callers only handle success
// (Promise<boolean> — same context contract as the localStorage era).
// localStorage is READ-only legacy: a one-time per-user import salvages
// pre-Stage-4 data to the server, then purges the local PII keys. The app
// never writes local account PII again.
// ============================================================================

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { normalizeBDPhone } from "@/lib/bd-phone";
import { normalizeCustomMeasurements, type CanonicalMeasurementKey } from "@/lib/measurements";
import type { CheckoutAddress } from "@/lib/checkout-ui";
import {
  accountErrorMessage,
  type AccountSnapshot,
  type FitPreferenceValue,
  type ServerMeasurement,
  type ServerSavedAddress,
} from "@/lib/account-shared";
import {
  deleteAddressFn,
  deleteMeasurementFn,
  getMyAccountFn,
  importAccountDataFn,
  saveProfileFn,
  setDefaultAddressFn,
  upsertAddressFn,
  upsertMeasurementFn,
} from "@/lib/account.api";

// ---- Types ------------------------------------------------------------------
// Addresses/measurements ARE the server DTOs — one shape from RPC to render.

export interface AccountProfile {
  name: string;
  /** Read-only — auth.users owns the email (change-email is an auth flow). */
  email: string;
  phone: string;
  birthday: string;
}

export type SavedAddress = ServerSavedAddress;
export type FitPreference = FitPreferenceValue;
export type MeasurementProfile = ServerMeasurement;

// ---- Safe defaults (no fake personal data) ----------------------------------

export const DEFAULT_PROFILE: AccountProfile = {
  name: "Guest Customer",
  email: "",
  phone: "",
  birthday: "",
};

export const MEASURE_FIELDS = [
  { key: "bust", label: "Bust" },
  { key: "waist", label: "Waist" },
  { key: "hip", label: "Hip" },
  { key: "shoulder", label: "Shoulder" },
  { key: "sleeve", label: "Sleeve" },
  { key: "dressLength", label: "Dress length" },
] as const;

export const FIT_PREFERENCES: FitPreference[] = ["Fitted", "Regular", "Relaxed"];

// ---- Legacy localStorage (pre-Stage-4) — import-only ------------------------
// The readers below exist solely to salvage data written before accounts were
// server-backed; the writers are kept for tests that simulate such browsers.
// Account PII was partitioned per signed-in user (scopedKey); the bare base
// keys predate namespacing and are purged on every account mount.

const PROFILE_KEY = "nongorr_account_profile";
const ADDRESSES_KEY = "nongorr_account_addresses";
const MEASUREMENTS_KEY = "nongorr_measurement_profiles";
const LEGACY_ACCOUNT_KEYS = [PROFILE_KEY, ADDRESSES_KEY, MEASUREMENTS_KEY];

/** One-shot import seal, set only after the server confirms the migration. */
const MIGRATION_FLAG_KEY = "nongorr_account_migrated_v1";

/** Per-user storage key. `scope` is the verified auth user id from the session. */
function scopedKey(base: string, scope: string): string {
  return `${base}::u:${scope}`;
}

export function migrationFlagKey(scope: string): string {
  return scopedKey(MIGRATION_FLAG_KEY, scope);
}

/**
 * Remove pre-namespacing unscoped account keys so one browser user's PII can
 * never be read by a different account. Idempotent; safe to call on every mount.
 */
export function purgeLegacyAccountKeys(): void {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_ACCOUNT_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore storage failures
    }
  }
}

/** Remove THIS user's local PII partition (after a confirmed server import). */
export function purgeScopedAccountKeys(scope: string): void {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_ACCOUNT_KEYS) {
    try {
      window.localStorage.removeItem(scopedKey(key, scope));
    } catch {
      // ignore storage failures
    }
  }
}

interface StoredAccountData<T> {
  version: 1;
  data: T;
}

// Unwrap either the versioned wrapper or a legacy unwrapped value.
function unwrap<T>(parsed: unknown): unknown {
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "version" in (parsed as Record<string, unknown>) &&
    "data" in (parsed as Record<string, unknown>)
  ) {
    return (parsed as StoredAccountData<T>).data;
  }
  return parsed;
}

function readRaw(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeRaw<T>(key: string, data: T): boolean {
  if (typeof window === "undefined") return false;
  try {
    const payload: StoredAccountData<T> = { version: 1, data };
    window.localStorage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

// ---- Coercion helpers -------------------------------------------------------

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function safeISO(value: unknown): string {
  const s = typeof value === "string" ? value : "";
  if (s && Number.isFinite(Date.parse(s))) return s;
  return new Date().toISOString();
}

// ---- Legacy readers (validate, never throw) ----------------------------------

export function readProfile(scope: string): AccountProfile {
  const raw = unwrap<AccountProfile>(readRaw(scopedKey(PROFILE_KEY, scope)));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_PROFILE };
  }
  const o = raw as Record<string, unknown>;
  return {
    name: str(o.name, DEFAULT_PROFILE.name) || DEFAULT_PROFILE.name,
    email: str(o.email, DEFAULT_PROFILE.email),
    phone: str(o.phone, DEFAULT_PROFILE.phone),
    birthday: str(o.birthday, DEFAULT_PROFILE.birthday),
  };
}

function normalizeAddress(raw: unknown): SavedAddress | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  const recipient = str(o.recipient);
  const district = str(o.district);
  const area = str(o.area);
  const address = str(o.address);
  if (!id || !recipient || !district || !area || !address) return null;
  return {
    id,
    label: typeof o.label === "string" ? o.label : undefined,
    recipient,
    phone: str(o.phone),
    district,
    area,
    address,
    isDefault: bool(o.isDefault),
  };
}

// Enforce: at most one default. If none, no default (caller may promote).
function normalizeDefaults(list: SavedAddress[]): SavedAddress[] {
  let seen = false;
  return list.map((a) => {
    if (a.isDefault && !seen) {
      seen = true;
      return a;
    }
    return a.isDefault ? { ...a, isDefault: false } : a;
  });
}

export function readAddresses(scope: string): SavedAddress[] {
  const raw = unwrap<SavedAddress[]>(readRaw(scopedKey(ADDRESSES_KEY, scope)));
  if (!Array.isArray(raw)) return [];
  const cleaned = raw.map(normalizeAddress).filter((a): a is SavedAddress => a !== null);
  return normalizeDefaults(cleaned);
}

function isFit(value: unknown): value is FitPreference {
  return value === "Fitted" || value === "Regular" || value === "Relaxed";
}

function normalizeMeasurement(raw: unknown): MeasurementProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  const name = str(o.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    bust: str(o.bust),
    waist: str(o.waist),
    hip: str(o.hip),
    shoulder: str(o.shoulder),
    sleeve: str(o.sleeve),
    dressLength: str(o.dressLength),
    fitPreference: isFit(o.fitPreference) ? o.fitPreference : "Regular",
    updatedAt: safeISO(o.updatedAt),
  };
}

export function readMeasurements(scope: string): MeasurementProfile[] {
  const raw = unwrap<MeasurementProfile[]>(readRaw(scopedKey(MEASUREMENTS_KEY, scope)));
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeMeasurement).filter((m): m is MeasurementProfile => m !== null);
}

// ---- Legacy writers (tests only — simulate a pre-Stage-4 browser) ------------

export function writeProfile(scope: string, profile: AccountProfile): boolean {
  return writeRaw(scopedKey(PROFILE_KEY, scope), profile);
}

export function writeAddresses(scope: string, addresses: SavedAddress[]): boolean {
  return writeRaw(scopedKey(ADDRESSES_KEY, scope), addresses);
}

export function writeMeasurements(scope: string, profiles: MeasurementProfile[]): boolean {
  return writeRaw(scopedKey(MEASUREMENTS_KEY, scope), profiles);
}

// ---- Utilities --------------------------------------------------------------

export function isValidAccountPhone(value: string): boolean {
  return /^01[3-9]\d{8}$/.test(normalizeBDPhone(value));
}

export function isPositiveNumber(value: string): boolean {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

export function initials(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "GC";
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "GC";
  if (words.length === 1) {
    const w = Array.from(words[0]);
    return (w.slice(0, 2).join("") || "GC").toUpperCase();
  }
  const first = Array.from(words[0])[0] ?? "";
  const last = Array.from(words[words.length - 1])[0] ?? "";
  const combo = `${first}${last}`.trim();
  return (combo || "GC").toUpperCase();
}

export function formatUpdated(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Recently updated";
  try {
    return `Updated ${new Date(t).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`;
  } catch {
    return "Recently updated";
  }
}

export function measurementDisplay(value: string): string {
  return isPositiveNumber(value) ? `${Number(value)} in` : "—";
}

// ---- Dependency-safe adapters -----------------------------------------------
// The shared CheckoutAddress shape and canonical measurement keys live in
// checkout-ui.ts / measurements.ts. account-ui imports those (one-way), so no
// cycle is introduced.

/** Map a saved address to the shared checkout address shape. */
export function savedAddressToCheckoutAddress(a: SavedAddress): CheckoutAddress {
  return {
    recipient: a.recipient,
    phone: a.phone,
    district: a.district,
    area: a.area,
    address: a.address,
  };
}

/**
 * Map a saved measurement profile to a canonical-keyed custom-size record,
 * keeping only positive numeric values (ready for the PDP custom-size form).
 */
export function measurementProfileToCustomSize(
  m: MeasurementProfile,
): Partial<Record<CanonicalMeasurementKey, string>> {
  const source: Record<string, string> = {
    bust: m.bust,
    waist: m.waist,
    hip: m.hip,
    shoulder: m.shoulder,
    sleeve: m.sleeve,
    dressLength: m.dressLength,
  };
  const normalized = normalizeCustomMeasurements(source);
  // Keep only positive numeric values.
  const out: Partial<Record<CanonicalMeasurementKey, string>> = {};
  for (const [k, v] of Object.entries(normalized)) {
    if (typeof v === "string" && isPositiveNumber(v)) out[k as CanonicalMeasurementKey] = v;
  }
  return out;
}

// Build a non-conflicting "(Copy)" name within the existing set.
function duplicateName(base: string, existing: string[]): string {
  const root = base.replace(/\s*\(Copy(?:\s\d+)?\)\s*$/, "");
  let candidate = `${root} (Copy)`;
  if (!existing.includes(candidate)) return candidate;
  let n = 2;
  while (existing.includes((candidate = `${root} (Copy ${n})`))) n++;
  return candidate;
}

// ---- Snapshot → UI state ------------------------------------------------------

function toAccountProfile(
  snapshot: AccountSnapshot | null,
  fallback?: Partial<AccountProfile>,
): AccountProfile {
  return {
    name: snapshot?.profile?.fullName || fallback?.name || DEFAULT_PROFILE.name,
    email: snapshot?.email || fallback?.email || "",
    phone: snapshot?.profile?.phone ?? "",
    birthday: snapshot?.profile?.birthday ?? "",
  };
}

/**
 * Fold a canonical server row into the list (replace-or-append). The server
 * clears other defaults atomically when the row is default — mirror that.
 */
function applyServerAddress(list: SavedAddress[], row: SavedAddress): SavedAddress[] {
  const exists = list.some((a) => a.id === row.id);
  const next = exists ? list.map((a) => (a.id === row.id ? row : a)) : [...list, row];
  return row.isDefault ? next.map((a) => (a.id === row.id ? a : { ...a, isDefault: false })) : next;
}

// ---- One-time legacy import ---------------------------------------------------

const IMPORT_STRING_MAX = 600; // importPayloadSchema bound — clip, never reject

function clip(value: string): string {
  return value.slice(0, IMPORT_STRING_MAX);
}

function sealMigration(scope: string): void {
  try {
    window.localStorage.setItem(migrationFlagKey(scope), new Date().toISOString());
  } catch {
    // ignore storage failures
  }
  purgeScopedAccountKeys(scope);
}

/**
 * Salvage this browser's pre-Stage-4 data to the server exactly once per user.
 * The flag is set and the local PII keys purged only after the server confirms
 * (import succeeded, was already done, or there was nothing worth keeping);
 * a network failure leaves everything untouched for a retry on the next visit.
 */
async function runLegacyImport(
  scope: string,
  snapshot: AccountSnapshot,
  onSynced: (fresh: AccountSnapshot) => void,
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(migrationFlagKey(scope))) return;
  } catch {
    return;
  }

  const localProfile = readProfile(scope);
  const localAddresses = readAddresses(scope);
  const localMeasurements = readMeasurements(scope);

  const customName = localProfile.name !== DEFAULT_PROFILE.name;
  const profileHasData = customName || !!localProfile.phone || !!localProfile.birthday;
  const hasLocal = profileHasData || localAddresses.length > 0 || localMeasurements.length > 0;
  const serverEmpty =
    !snapshot.profile && snapshot.addresses.length === 0 && snapshot.measurements.length === 0;

  // Nothing to salvage, or the server already holds account data (it is the
  // truth) — seal the migration and drop the stale local copy.
  if (!hasLocal || !serverEmpty) {
    sealMigration(scope);
    return;
  }

  const payload = {
    profile: profileHasData
      ? {
          fullName: customName ? clip(localProfile.name) : "",
          phone: clip(localProfile.phone),
          birthday: clip(localProfile.birthday),
        }
      : undefined,
    addresses: localAddresses.slice(0, 20).map((a) => ({
      label: clip(a.label ?? ""),
      recipient: clip(a.recipient),
      phone: clip(a.phone),
      district: clip(a.district),
      area: clip(a.area),
      address: clip(a.address),
      isDefault: a.isDefault,
    })),
    measurements: localMeasurements.slice(0, 20).map((m) => ({
      name: clip(m.name),
      bust: clip(m.bust),
      waist: clip(m.waist),
      hip: clip(m.hip),
      shoulder: clip(m.shoulder),
      sleeve: clip(m.sleeve),
      dressLength: clip(m.dressLength),
      fitPreference: m.fitPreference,
    })),
  };

  try {
    const res = await importAccountDataFn({ data: payload });
    const alreadyImported = !res.success && (res as { code?: string }).code === "already_imported";
    if (!res.success && !alreadyImported) return; // retry on the next visit

    // Confirmed server-side — show the imported rows, then seal + purge.
    try {
      const fresh = await getMyAccountFn();
      if (fresh.success) onSynced(fresh.account);
    } catch {
      // refresh is cosmetic — the import itself is confirmed
    }
    sealMigration(scope);
    if (res.success) {
      toast.success("Your saved details from this browser are now synced to your account.");
    }
  } catch {
    // Network failure — keep the local data; retried on the next account visit.
  }
}

// ---- Reactive provider ------------------------------------------------------

interface AccountUIContextValue {
  hydrated: boolean;
  profile: AccountProfile;
  addresses: SavedAddress[];
  measurements: MeasurementProfile[];

  saveProfile(profile: AccountProfile): Promise<boolean>;

  addAddress(address: Omit<SavedAddress, "id">): Promise<boolean>;
  updateAddress(address: SavedAddress): Promise<boolean>;
  deleteAddress(id: string): Promise<boolean>;
  setDefaultAddress(id: string): Promise<boolean>;

  addMeasurement(profile: Omit<MeasurementProfile, "id" | "updatedAt">): Promise<boolean>;
  updateMeasurement(profile: MeasurementProfile): Promise<boolean>;
  duplicateMeasurement(id: string): Promise<boolean>;
  deleteMeasurement(id: string): Promise<boolean>;
}

const AccountUIContext = createContext<AccountUIContextValue | null>(null);

/** Run a write server fn; on failure toast the specific message and return null. */
async function runWrite<T extends { success: boolean }>(
  op: () => Promise<T>,
): Promise<Extract<T, { success: true }> | null> {
  try {
    const res = await op();
    if (!res.success) {
      toast.error((res as { error?: string }).error || accountErrorMessage(null));
      return null;
    }
    return res as Extract<T, { success: true }>;
  } catch {
    toast.error(accountErrorMessage(null));
    return null;
  }
}

export function AccountUIProvider({
  children,
  scope,
  initialSnapshot,
  initialProfile,
}: {
  children: ReactNode;
  /** Verified auth user id — keys the migration flag; the server scopes data. */
  scope: string;
  /** Loader-fetched server snapshot; null when that load failed. */
  initialSnapshot: AccountSnapshot | null;
  /** Session fallbacks for the header until a profile row exists. */
  initialProfile?: Partial<AccountProfile>;
}) {
  const [profile, setProfile] = useState<AccountProfile>(() =>
    toAccountProfile(initialSnapshot, initialProfile),
  );
  const [addresses, setAddresses] = useState<SavedAddress[]>(
    () => initialSnapshot?.addresses ?? [],
  );
  const [measurements, setMeasurements] = useState<MeasurementProfile[]>(
    () => initialSnapshot?.measurements ?? [],
  );

  // One-time legacy import (client only; the ref survives loader re-renders).
  const importStarted = useRef(false);
  useEffect(() => {
    purgeLegacyAccountKeys();
    if (importStarted.current || !initialSnapshot) return;
    importStarted.current = true;
    void runLegacyImport(scope, initialSnapshot, (fresh) => {
      setProfile(toAccountProfile(fresh, initialProfile));
      setAddresses(fresh.addresses);
      setMeasurements(fresh.measurements);
    });
    // initialProfile is a per-render object; the ref guard makes re-runs no-ops.
  }, [scope, initialSnapshot, initialProfile]);

  const saveProfile: AccountUIContextValue["saveProfile"] = async (next) => {
    const prev = profile;
    setProfile({ ...next, email: prev.email }); // email is auth-owned
    const res = await runWrite(() =>
      saveProfileFn({
        data: { fullName: next.name, phone: next.phone, birthday: next.birthday },
      }),
    );
    if (!res) {
      setProfile(prev);
      return false;
    }
    setProfile((cur) => ({
      ...cur,
      name: res.profile.fullName,
      phone: res.profile.phone,
      birthday: res.profile.birthday,
    }));
    return true;
  };

  const addAddress: AccountUIContextValue["addAddress"] = async (address) => {
    // Pessimistic: the row id (and first-address default promotion) come from
    // the server; the canonical row is appended on success.
    const res = await runWrite(() =>
      upsertAddressFn({
        data: {
          label: address.label,
          recipient: address.recipient,
          phone: address.phone,
          district: address.district,
          area: address.area,
          address: address.address,
          isDefault: address.isDefault,
        },
      }),
    );
    if (!res) return false;
    setAddresses((cur) => applyServerAddress(cur, res.address));
    return true;
  };

  const updateAddress: AccountUIContextValue["updateAddress"] = async (address) => {
    const prev = addresses;
    let next = prev.map((a) => (a.id === address.id ? address : a));
    if (address.isDefault) {
      next = next.map((a) => (a.id === address.id ? a : { ...a, isDefault: false }));
    } else if (!next.some((a) => a.isDefault) && next.length > 0) {
      next = next.map((a, i) => (i === 0 ? { ...a, isDefault: true } : a));
    }
    setAddresses(next);
    const res = await runWrite(() =>
      upsertAddressFn({
        data: {
          id: address.id,
          label: address.label,
          recipient: address.recipient,
          phone: address.phone,
          district: address.district,
          area: address.area,
          address: address.address,
          isDefault: address.isDefault,
        },
      }),
    );
    if (!res) {
      setAddresses(prev);
      return false;
    }
    setAddresses((cur) => applyServerAddress(cur, res.address));
    return true;
  };

  const deleteAddress: AccountUIContextValue["deleteAddress"] = async (id) => {
    const prev = addresses;
    const removed = prev.find((a) => a.id === id);
    if (!removed) return false;
    // Mirror the server: deleting the default promotes the oldest remaining
    // (lists arrive created_at-ordered, so index 0 IS the oldest).
    let next = prev.filter((a) => a.id !== id);
    if (removed.isDefault && next.length > 0 && !next.some((a) => a.isDefault)) {
      next = next.map((a, i) => (i === 0 ? { ...a, isDefault: true } : a));
    }
    setAddresses(next);
    const res = await runWrite(() => deleteAddressFn({ data: { id } }));
    if (!res) {
      setAddresses(prev);
      return false;
    }
    return true;
  };

  const setDefaultAddress: AccountUIContextValue["setDefaultAddress"] = async (id) => {
    const prev = addresses;
    if (!prev.some((a) => a.id === id)) return false;
    setAddresses(prev.map((a) => ({ ...a, isDefault: a.id === id })));
    const res = await runWrite(() => setDefaultAddressFn({ data: { id } }));
    if (!res) {
      setAddresses(prev);
      return false;
    }
    setAddresses((cur) => applyServerAddress(cur, res.address));
    return true;
  };

  const addMeasurement: AccountUIContextValue["addMeasurement"] = async (p) => {
    const res = await runWrite(() =>
      upsertMeasurementFn({
        data: {
          name: p.name,
          bust: p.bust,
          waist: p.waist,
          hip: p.hip,
          shoulder: p.shoulder,
          sleeve: p.sleeve,
          dressLength: p.dressLength,
          fitPreference: p.fitPreference,
        },
      }),
    );
    if (!res) return false;
    setMeasurements((cur) => [...cur, res.measurement]);
    return true;
  };

  const updateMeasurement: AccountUIContextValue["updateMeasurement"] = async (p) => {
    const prev = measurements;
    setMeasurements(
      prev.map((m) => (m.id === p.id ? { ...p, updatedAt: new Date().toISOString() } : m)),
    );
    const res = await runWrite(() =>
      upsertMeasurementFn({
        data: {
          id: p.id,
          name: p.name,
          bust: p.bust,
          waist: p.waist,
          hip: p.hip,
          shoulder: p.shoulder,
          sleeve: p.sleeve,
          dressLength: p.dressLength,
          fitPreference: p.fitPreference,
        },
      }),
    );
    if (!res) {
      setMeasurements(prev);
      return false;
    }
    setMeasurements((cur) => cur.map((m) => (m.id === p.id ? res.measurement : m)));
    return true;
  };

  const duplicateMeasurement: AccountUIContextValue["duplicateMeasurement"] = async (id) => {
    const src = measurements.find((m) => m.id === id);
    if (!src) return false;
    const res = await runWrite(() =>
      upsertMeasurementFn({
        data: {
          name: duplicateName(
            src.name,
            measurements.map((m) => m.name),
          ),
          bust: src.bust,
          waist: src.waist,
          hip: src.hip,
          shoulder: src.shoulder,
          sleeve: src.sleeve,
          dressLength: src.dressLength,
          fitPreference: src.fitPreference,
        },
      }),
    );
    if (!res) return false;
    setMeasurements((cur) => [...cur, res.measurement]);
    return true;
  };

  const deleteMeasurement: AccountUIContextValue["deleteMeasurement"] = async (id) => {
    const prev = measurements;
    setMeasurements(prev.filter((m) => m.id !== id));
    const res = await runWrite(() => deleteMeasurementFn({ data: { id } }));
    if (!res) {
      setMeasurements(prev);
      return false;
    }
    return true;
  };

  return (
    <AccountUIContext.Provider
      value={{
        // Data now arrives via the SSR route loader — kept for contract compat.
        hydrated: true,
        profile,
        addresses,
        measurements,
        saveProfile,
        addAddress,
        updateAddress,
        deleteAddress,
        setDefaultAddress,
        addMeasurement,
        updateMeasurement,
        duplicateMeasurement,
        deleteMeasurement,
      }}
    >
      {children}
    </AccountUIContext.Provider>
  );
}

export function useAccountUI(): AccountUIContextValue {
  const ctx = useContext(AccountUIContext);
  if (!ctx) {
    throw new Error("useAccountUI must be used within AccountUIProvider");
  }
  return ctx;
}
