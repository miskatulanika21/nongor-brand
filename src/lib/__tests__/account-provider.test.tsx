/**
 * Stage 4 P4 — server-backed AccountUIProvider:
 *   - seeds state from the loader snapshot (SSR, no skeleton flash)
 *   - optimistic mutations with rollback + the server's specific error toast
 *   - one-time localStorage → server import, sealed by a per-user flag and
 *     followed by a PII purge ONLY after the server confirms
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AccountSnapshot } from "@/lib/account-shared";
import {
  AccountUIProvider,
  useAccountUI,
  migrationFlagKey,
  writeProfile,
  writeAddresses,
  writeMeasurements,
  DEFAULT_PROFILE,
  type SavedAddress,
  type MeasurementProfile,
} from "@/lib/account-ui";
import {
  getMyAccountFn,
  importAccountDataFn,
  saveProfileFn,
  upsertAddressFn,
  deleteAddressFn,
  setDefaultAddressFn,
  upsertMeasurementFn,
  deleteMeasurementFn,
} from "@/lib/account.api";
import { toast } from "sonner";

vi.mock("@/lib/account.api", () => ({
  getMyAccountFn: vi.fn(),
  importAccountDataFn: vi.fn(),
  saveProfileFn: vi.fn(),
  upsertAddressFn: vi.fn(),
  deleteAddressFn: vi.fn(),
  setDefaultAddressFn: vi.fn(),
  upsertMeasurementFn: vi.fn(),
  deleteMeasurementFn: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const m = (fn: unknown) => fn as Mock;

const SCOPE = "user-aaaa";

const ADDR1: SavedAddress = {
  id: "a1",
  recipient: "Amina Rahman",
  phone: "01712345678",
  district: "Dhaka",
  area: "Gulshan",
  address: "House 1, Road 2",
  isDefault: true,
};
const ADDR2: SavedAddress = { ...ADDR1, id: "a2", recipient: "Office", isDefault: false };

const MEAS1: MeasurementProfile = {
  id: "m1",
  name: "Everyday",
  bust: "34",
  waist: "28",
  hip: "36",
  shoulder: "14",
  sleeve: "22",
  dressLength: "44",
  fitPreference: "Regular",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const SNAPSHOT: AccountSnapshot = {
  email: "amina@nongorr.com",
  profile: {
    fullName: "Amina Rahman",
    phone: "01712345678",
    birthday: "1995-05-05",
    updatedAt: "2026-07-01T00:00:00.000Z",
  },
  addresses: [ADDR1, ADDR2],
  measurements: [MEAS1],
};

const EMPTY_SNAPSHOT: AccountSnapshot = {
  email: "amina@nongorr.com",
  profile: null,
  addresses: [],
  measurements: [],
};

function wrap(snapshot: AccountSnapshot | null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AccountUIProvider
        scope={SCOPE}
        initialSnapshot={snapshot}
        initialProfile={{ name: "Session Name", email: "session@nongorr.com" }}
      >
        {children}
      </AccountUIProvider>
    );
  };
}

async function renderAccount(snapshot: AccountSnapshot | null) {
  const utils = renderHook(() => useAccountUI(), { wrapper: wrap(snapshot) });
  await act(async () => {}); // flush the one-time import effect
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

// ── Seeding ───────────────────────────────────────────────────────────────────

describe("snapshot seeding", () => {
  it("seeds profile/addresses/measurements from the loader snapshot", async () => {
    const { result } = await renderAccount(SNAPSHOT);
    expect(result.current.hydrated).toBe(true);
    expect(result.current.profile).toEqual({
      name: "Amina Rahman",
      email: "amina@nongorr.com",
      phone: "01712345678",
      birthday: "1995-05-05",
    });
    expect(result.current.addresses).toHaveLength(2);
    expect(result.current.measurements).toHaveLength(1);
  });

  it("falls back to the session identity until a profile row exists", async () => {
    const { result } = await renderAccount(EMPTY_SNAPSHOT);
    expect(result.current.profile.name).toBe("Session Name");
    // Snapshot email (auth truth) wins over the session fallback.
    expect(result.current.profile.email).toBe("amina@nongorr.com");
  });
});

// ── Optimistic mutations + rollback ───────────────────────────────────────────

describe("mutations", () => {
  it("saveProfile applies the canonical server row and never lets email drift", async () => {
    m(saveProfileFn).mockResolvedValue({
      success: true,
      profile: { fullName: "Amina R.", phone: "", birthday: "", updatedAt: "x" },
    });
    const { result } = await renderAccount(SNAPSHOT);
    let ok = false;
    await act(async () => {
      ok = await result.current.saveProfile({
        name: "Amina R.",
        email: "attacker@evil.com", // ignored — auth owns the email
        phone: "",
        birthday: "",
      });
    });
    expect(ok).toBe(true);
    expect(result.current.profile.name).toBe("Amina R.");
    expect(result.current.profile.phone).toBe("");
    expect(result.current.profile.email).toBe("amina@nongorr.com");
  });

  it("saveProfile rolls back and surfaces the specific server error", async () => {
    m(saveProfileFn).mockResolvedValue({
      success: false,
      error: "Enter a valid Bangladeshi mobile number (e.g. 01712345678).",
      code: "invalid_phone",
    });
    const { result } = await renderAccount(SNAPSHOT);
    let ok = true;
    await act(async () => {
      ok = await result.current.saveProfile({ ...result.current.profile, name: "Changed" });
    });
    expect(ok).toBe(false);
    expect(result.current.profile.name).toBe("Amina Rahman");
    expect(toast.error).toHaveBeenCalledWith(
      "Enter a valid Bangladeshi mobile number (e.g. 01712345678).",
    );
  });

  it("updateAddress is optimistic mid-flight and rolls back on failure", async () => {
    let resolveUpsert!: (v: unknown) => void;
    m(upsertAddressFn).mockReturnValue(new Promise((r) => (resolveUpsert = r)));
    const { result } = await renderAccount(SNAPSHOT);

    let done!: Promise<boolean>;
    act(() => {
      done = result.current.updateAddress({ ...ADDR2, recipient: "Edited Office" });
    });
    // Optimistic: visible before the server answers.
    expect(result.current.addresses.find((a) => a.id === "a2")?.recipient).toBe("Edited Office");

    await act(async () => {
      resolveUpsert({ success: false, error: "That address no longer exists." });
      await done;
    });
    expect(result.current.addresses.find((a) => a.id === "a2")?.recipient).toBe("Office");
    expect(toast.error).toHaveBeenCalledWith("That address no longer exists.");
  });

  it("addAddress appends the canonical server row and mirrors its default flip", async () => {
    const serverRow: SavedAddress = { ...ADDR1, id: "a3", recipient: "New Home", isDefault: true };
    m(upsertAddressFn).mockResolvedValue({ success: true, address: serverRow });
    const { result } = await renderAccount(SNAPSHOT);
    await act(async () => {
      await result.current.addAddress({ ...serverRow });
    });
    expect(result.current.addresses).toHaveLength(3);
    const defaults = result.current.addresses.filter((a) => a.isDefault);
    expect(defaults).toEqual([serverRow]);
  });

  it("deleteAddress promotes the oldest remaining address when the default is removed", async () => {
    m(deleteAddressFn).mockResolvedValue({ success: true });
    const { result } = await renderAccount(SNAPSHOT);
    await act(async () => {
      await result.current.deleteAddress("a1"); // the default
    });
    expect(result.current.addresses).toHaveLength(1);
    expect(result.current.addresses[0]).toMatchObject({ id: "a2", isDefault: true });
  });

  it("setDefaultAddress rolls back the flip when the server rejects", async () => {
    m(setDefaultAddressFn).mockRejectedValue(new Error("network"));
    const { result } = await renderAccount(SNAPSHOT);
    let ok = true;
    await act(async () => {
      ok = await result.current.setDefaultAddress("a2");
    });
    expect(ok).toBe(false);
    expect(result.current.addresses.find((a) => a.id === "a1")?.isDefault).toBe(true);
    expect(toast.error).toHaveBeenCalled();
  });

  it("duplicateMeasurement sends a '(Copy)' name and appends the server row", async () => {
    const serverRow: MeasurementProfile = { ...MEAS1, id: "m2", name: "Everyday (Copy)" };
    m(upsertMeasurementFn).mockResolvedValue({ success: true, measurement: serverRow });
    const { result } = await renderAccount(SNAPSHOT);
    await act(async () => {
      await result.current.duplicateMeasurement("m1");
    });
    expect(m(upsertMeasurementFn).mock.calls[0][0].data.name).toBe("Everyday (Copy)");
    expect(result.current.measurements).toHaveLength(2);
    expect(result.current.measurements[1]).toEqual(serverRow);
  });

  it("deleteMeasurement rolls back on failure", async () => {
    m(deleteMeasurementFn).mockResolvedValue({ success: false, error: "nope" });
    const { result } = await renderAccount(SNAPSHOT);
    let ok = true;
    await act(async () => {
      ok = await result.current.deleteMeasurement("m1");
    });
    expect(ok).toBe(false);
    expect(result.current.measurements).toHaveLength(1);
  });
});

// ── One-time localStorage import ──────────────────────────────────────────────

const scopedAddressesKey = `nongorr_account_addresses::u:${SCOPE}`;

function seedLegacyData() {
  writeProfile(SCOPE, {
    name: "Amina Rahman",
    email: "old@local.com",
    phone: "01712345678",
    birthday: "1995-05-05",
  });
  writeAddresses(SCOPE, [ADDR1]);
  writeMeasurements(SCOPE, [MEAS1]);
}

describe("one-time legacy import", () => {
  it("imports local data when the server is empty, then seals + purges", async () => {
    seedLegacyData();
    m(importAccountDataFn).mockResolvedValue({
      success: true,
      result: {
        profile: true,
        addresses: 1,
        addressesSkipped: 0,
        measurements: 1,
        measurementsSkipped: 0,
      },
    });
    m(getMyAccountFn).mockResolvedValue({ success: true, account: SNAPSHOT });

    const { result } = await renderAccount(EMPTY_SNAPSHOT);

    const payload = m(importAccountDataFn).mock.calls[0][0].data;
    expect(payload.profile).toEqual({
      fullName: "Amina Rahman",
      phone: "01712345678",
      birthday: "1995-05-05",
    });
    expect(payload.addresses).toHaveLength(1);
    expect(payload.addresses[0]).toMatchObject({ recipient: "Amina Rahman", isDefault: true });
    expect(payload.measurements).toHaveLength(1);

    // State now shows the refetched (imported) server rows.
    expect(result.current.addresses).toHaveLength(2);
    // Sealed + purged.
    expect(localStorage.getItem(migrationFlagKey(SCOPE))).toBeTruthy();
    expect(localStorage.getItem(scopedAddressesKey)).toBeNull();
    expect(toast.success).toHaveBeenCalled();
  });

  it("does nothing when the migration flag is already set", async () => {
    seedLegacyData();
    localStorage.setItem(migrationFlagKey(SCOPE), "2026-07-02T00:00:00.000Z");
    await renderAccount(EMPTY_SNAPSHOT);
    expect(importAccountDataFn).not.toHaveBeenCalled();
  });

  it("skips the import when the server already holds data (server is truth)", async () => {
    seedLegacyData();
    await renderAccount(SNAPSHOT);
    expect(importAccountDataFn).not.toHaveBeenCalled();
    // Stale local copy is still sealed away + purged.
    expect(localStorage.getItem(migrationFlagKey(SCOPE))).toBeTruthy();
    expect(localStorage.getItem(scopedAddressesKey)).toBeNull();
  });

  it("seals without importing when there is nothing local to salvage", async () => {
    await renderAccount(EMPTY_SNAPSHOT);
    expect(importAccountDataFn).not.toHaveBeenCalled();
    expect(localStorage.getItem(migrationFlagKey(SCOPE))).toBeTruthy();
  });

  it("keeps local data (no flag, no purge) when the import fails — retried next visit", async () => {
    seedLegacyData();
    m(importAccountDataFn).mockResolvedValue({
      success: false,
      error: "Something went wrong. Please try again.",
      code: "internal_error",
    });
    await renderAccount(EMPTY_SNAPSHOT);
    expect(localStorage.getItem(migrationFlagKey(SCOPE))).toBeNull();
    expect(localStorage.getItem(scopedAddressesKey)).not.toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("treats already_imported as sealed (purges the stale local copy)", async () => {
    seedLegacyData();
    m(importAccountDataFn).mockResolvedValue({
      success: false,
      error: "Your account data is already synced.",
      code: "already_imported",
    });
    m(getMyAccountFn).mockResolvedValue({ success: true, account: SNAPSHOT });
    await renderAccount(EMPTY_SNAPSHOT);
    expect(localStorage.getItem(migrationFlagKey(SCOPE))).toBeTruthy();
    expect(localStorage.getItem(scopedAddressesKey)).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("never treats the default 'Guest Customer' name as importable profile data", async () => {
    writeProfile(SCOPE, { ...DEFAULT_PROFILE }); // untouched defaults only
    await renderAccount(EMPTY_SNAPSHOT);
    expect(importAccountDataFn).not.toHaveBeenCalled();
    expect(localStorage.getItem(migrationFlagKey(SCOPE))).toBeTruthy();
  });
});
