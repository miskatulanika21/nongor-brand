// ============================================================================
// Account UI — FRONTEND-ONLY local prototype state.
// Data is stored only in this browser (localStorage). There is NO authentication,
// NO server, NO database and NO cross-device sync.
// TODO(backend): replace with Supabase-backed profile/addresses/measurements + auth.
// ============================================================================

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  normalizeBDPhone,
  normalizeCustomMeasurements,
  type CanonicalMeasurementKey,
} from "@/lib/order-ui";
import type { CheckoutAddress } from "@/lib/checkout-ui";

// ---- Types ------------------------------------------------------------------

export interface AccountProfile {
  name: string;
  email: string;
  phone: string;
  birthday: string;
}

export interface SavedAddress {
  id: string;
  label?: string;
  recipient: string;
  phone: string;
  district: string;
  area: string;
  address: string;
  isDefault: boolean;
}

export type FitPreference = "Fitted" | "Regular" | "Relaxed";

export interface MeasurementProfile {
  id: string;
  name: string;
  bust: string;
  waist: string;
  hip: string;
  shoulder: string;
  sleeve: string;
  dressLength: string;
  fitPreference: FitPreference;
  updatedAt: string;
}

// ---- Safe defaults (no fake personal data) ----------------------------------

export const DEFAULT_PROFILE: AccountProfile = {
  name: "Guest Customer",
  email: "",
  phone: "",
  birthday: "",
};

export const DEFAULT_ADDRESSES: SavedAddress[] = [];

export const DEFAULT_MEASUREMENTS: MeasurementProfile[] = [];

export const MEASURE_FIELDS = [
  { key: "bust", label: "Bust" },
  { key: "waist", label: "Waist" },
  { key: "hip", label: "Hip" },
  { key: "shoulder", label: "Shoulder" },
  { key: "sleeve", label: "Sleeve" },
  { key: "dressLength", label: "Dress length" },
] as const;

export const FIT_PREFERENCES: FitPreference[] = ["Fitted", "Regular", "Relaxed"];

// ---- Storage keys -----------------------------------------------------------

const PROFILE_KEY = "nongorr_account_profile";
const ADDRESSES_KEY = "nongorr_account_addresses";
const MEASUREMENTS_KEY = "nongorr_measurement_profiles";

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

// ---- Readers (validate, never throw) ----------------------------------------

export function readProfile(): AccountProfile {
  const raw = unwrap<AccountProfile>(readRaw(PROFILE_KEY));
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

export function readAddresses(): SavedAddress[] {
  const raw = unwrap<SavedAddress[]>(readRaw(ADDRESSES_KEY));
  if (!Array.isArray(raw)) return [...DEFAULT_ADDRESSES];
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

export function readMeasurements(): MeasurementProfile[] {
  const raw = unwrap<MeasurementProfile[]>(readRaw(MEASUREMENTS_KEY));
  if (!Array.isArray(raw)) return [...DEFAULT_MEASUREMENTS];
  return raw.map(normalizeMeasurement).filter((m): m is MeasurementProfile => m !== null);
}

// ---- Writers (honest success/failure) ---------------------------------------

export function writeProfile(profile: AccountProfile): boolean {
  return writeRaw(PROFILE_KEY, profile);
}

export function writeAddresses(addresses: SavedAddress[]): boolean {
  return writeRaw(ADDRESSES_KEY, addresses);
}

export function writeMeasurements(profiles: MeasurementProfile[]): boolean {
  return writeRaw(MEASUREMENTS_KEY, profiles);
}

// ---- Utilities --------------------------------------------------------------

export function isValidAccountPhone(value: string): boolean {
  return /^01[3-9]\d{8}$/.test(normalizeBDPhone(value));
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function isPositiveNumber(value: string): boolean {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

export function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

export function safeDateValue(date: string): number {
  if (!date) return -Infinity;
  const t = Date.parse(date);
  return Number.isFinite(t) ? t : -Infinity;
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
// The shared CheckoutAddress shape and canonical measurement keys are defined in
// checkout-ui.ts / order-ui.ts. account-ui imports those (one-way) so no cycle
// is introduced — order-ui.ts must NOT import from account-ui.tsx.

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

// ---- Reactive provider ------------------------------------------------------

interface AccountUIContextValue {
  hydrated: boolean;
  profile: AccountProfile;
  addresses: SavedAddress[];
  measurements: MeasurementProfile[];

  saveProfile(profile: AccountProfile): boolean;

  addAddress(address: Omit<SavedAddress, "id">): boolean;
  updateAddress(address: SavedAddress): boolean;
  deleteAddress(id: string): boolean;
  setDefaultAddress(id: string): boolean;

  addMeasurement(profile: Omit<MeasurementProfile, "id" | "updatedAt">): boolean;
  updateMeasurement(profile: MeasurementProfile): boolean;
  duplicateMeasurement(id: string): boolean;
  deleteMeasurement(id: string): boolean;
}

const AccountUIContext = createContext<AccountUIContextValue | null>(null);

export function AccountUIProvider({
  children,
  initialProfile,
}: {
  children: ReactNode;
  initialProfile?: Partial<AccountProfile>;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [profile, setProfile] = useState<AccountProfile>(DEFAULT_PROFILE);
  const [addresses, setAddresses] = useState<SavedAddress[]>(DEFAULT_ADDRESSES);
  const [measurements, setMeasurements] = useState<MeasurementProfile[]>(DEFAULT_MEASUREMENTS);

  useEffect(() => {
    const localProfile = readProfile();
    setProfile({
      ...localProfile,
      ...(initialProfile?.name ? { name: initialProfile.name } : {}),
      ...(initialProfile?.email ? { email: initialProfile.email } : {}),
    });
    setAddresses(readAddresses());
    setMeasurements(readMeasurements());
    setHydrated(true);
  }, [initialProfile]);

  const saveProfile: AccountUIContextValue["saveProfile"] = (next) => {
    const ok = writeProfile(next);
    if (ok) setProfile(next);
    return ok;
  };

  const persistAddresses = (next: SavedAddress[]): boolean => {
    const normalized = normalizeDefaults(next);
    const ok = writeAddresses(normalized);
    if (ok) setAddresses(normalized);
    return ok;
  };

  const addAddress: AccountUIContextValue["addAddress"] = (address) => {
    const isFirst = addresses.length === 0;
    const entry: SavedAddress = {
      ...address,
      id: newId("addr"),
      isDefault: isFirst ? true : address.isDefault,
    };
    let next = [...addresses, entry];
    if (entry.isDefault) {
      next = next.map((a) => (a.id === entry.id ? a : { ...a, isDefault: false }));
    }
    return persistAddresses(next);
  };

  const updateAddress: AccountUIContextValue["updateAddress"] = (address) => {
    let next = addresses.map((a) => (a.id === address.id ? address : a));
    if (address.isDefault) {
      next = next.map((a) => (a.id === address.id ? a : { ...a, isDefault: false }));
    } else if (!next.some((a) => a.isDefault) && next.length > 0) {
      next = next.map((a, i) => (i === 0 ? { ...a, isDefault: true } : a));
    }
    return persistAddresses(next);
  };

  const deleteAddress: AccountUIContextValue["deleteAddress"] = (id) => {
    const removed = addresses.find((a) => a.id === id);
    let next = addresses.filter((a) => a.id !== id);
    if (removed?.isDefault && next.length > 0 && !next.some((a) => a.isDefault)) {
      next = next.map((a, i) => (i === 0 ? { ...a, isDefault: true } : a));
    }
    return persistAddresses(next);
  };

  const setDefaultAddress: AccountUIContextValue["setDefaultAddress"] = (id) => {
    if (!addresses.some((a) => a.id === id)) return false;
    const next = addresses.map((a) => ({ ...a, isDefault: a.id === id }));
    return persistAddresses(next);
  };

  const persistMeasurements = (next: MeasurementProfile[]): boolean => {
    const ok = writeMeasurements(next);
    if (ok) setMeasurements(next);
    return ok;
  };

  const addMeasurement: AccountUIContextValue["addMeasurement"] = (p) => {
    const entry: MeasurementProfile = {
      ...p,
      id: newId("meas"),
      updatedAt: new Date().toISOString(),
    };
    return persistMeasurements([...measurements, entry]);
  };

  const updateMeasurement: AccountUIContextValue["updateMeasurement"] = (p) => {
    const next = measurements.map((m) =>
      m.id === p.id ? { ...p, updatedAt: new Date().toISOString() } : m,
    );
    return persistMeasurements(next);
  };

  const duplicateMeasurement: AccountUIContextValue["duplicateMeasurement"] = (id) => {
    const src = measurements.find((m) => m.id === id);
    if (!src) return false;
    const entry: MeasurementProfile = {
      ...src,
      id: newId("meas"),
      name: duplicateName(
        src.name,
        measurements.map((m) => m.name),
      ),
      updatedAt: new Date().toISOString(),
    };
    return persistMeasurements([...measurements, entry]);
  };

  const deleteMeasurement: AccountUIContextValue["deleteMeasurement"] = (id) => {
    return persistMeasurements(measurements.filter((m) => m.id !== id));
  };

  return (
    <AccountUIContext.Provider
      value={{
        hydrated,
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
