import { describe, it, expect } from "vitest";
import {
  ACCOUNT_ERROR_MESSAGES,
  BD_PHONE_RE,
  FIT_PREFERENCE_VALUES,
  KNOWN_ACCOUNT_ERROR_CODES,
  MAX_SAVED_ADDRESSES,
  MAX_SAVED_MEASUREMENTS,
  MAX_WISHLIST_ITEMS,
  WISHLIST_SYNC_MAX_CODES,
  accountErrorMessage,
  accountIdSchema,
  addressInputSchema,
  importPayloadSchema,
  mapAccountSnapshot,
  mapAddressRow,
  mapImportResult,
  mapMeasurementRow,
  mapProfileRow,
  mapWishlistCodes,
  mapWishlistToggle,
  measurementInputSchema,
  profilePatchSchema,
  sanitizeWishlistCodes,
  toAddressPayload,
  toImportPayload,
  toMeasurementPayload,
  toProfilePatch,
  wishlistSyncSchema,
  wishlistToggleSchema,
} from "@/lib/account-shared";

const UUID = "11111111-1111-1111-1111-111111111111";

const validAddress = {
  recipient: "Rina Akter",
  phone: "01712345678",
  district: "Dhaka",
  area: "Dhanmondi",
  address: "House 1, Road 2",
};

const validMeasurement = {
  name: "Everyday",
  bust: "36.5",
  waist: "30",
  hip: "",
  shoulder: "",
  sleeve: "",
  dressLength: "",
  fitPreference: "Fitted" as const,
};

describe("profilePatchSchema (mirrors DB CHECKs)", () => {
  it("accepts a full valid patch and trims the name", () => {
    const r = profilePatchSchema.parse({
      fullName: " Rina Akter ",
      phone: "017-1234 5678",
      birthday: "1992-03-04",
    });
    expect(r.fullName).toBe("Rina Akter");
    expect(r.phone).toBe("01712345678"); // normalized before validation
    expect(r.birthday).toBe("1992-03-04");
  });

  it("accepts partial patches (presence semantics)", () => {
    expect(profilePatchSchema.parse({})).toEqual({});
    expect(profilePatchSchema.parse({ phone: "" })).toEqual({ phone: "" });
  });

  it("bounds the name at 120 (DB: 1..120)", () => {
    expect(profilePatchSchema.safeParse({ fullName: "a".repeat(120) }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ fullName: "a".repeat(121) }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ fullName: "  " }).success).toBe(false);
  });

  it("rejects phones that do not normalize to a BD mobile", () => {
    expect(profilePatchSchema.safeParse({ phone: "+8801712345678" }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ phone: "01112345678" }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ phone: "12345" }).success).toBe(false);
  });

  it("rejects malformed birthdays but allows clearing", () => {
    expect(profilePatchSchema.safeParse({ birthday: "" }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ birthday: "04/03/1992" }).success).toBe(false);
  });
});

describe("addressInputSchema (mirrors DB CHECKs)", () => {
  it("accepts a valid address; id and label optional", () => {
    expect(addressInputSchema.safeParse(validAddress).success).toBe(true);
    expect(
      addressInputSchema.safeParse({ ...validAddress, id: UUID, label: "Home", isDefault: true })
        .success,
    ).toBe(true);
  });

  it("requires recipient/district/area/address non-empty", () => {
    for (const key of ["recipient", "district", "area", "address"] as const) {
      expect(addressInputSchema.safeParse({ ...validAddress, [key]: " " }).success).toBe(false);
    }
  });

  it("enforces the DB length bounds", () => {
    expect(addressInputSchema.safeParse({ ...validAddress, label: "l".repeat(41) }).success).toBe(
      false,
    );
    expect(
      addressInputSchema.safeParse({ ...validAddress, address: "a".repeat(500) }).success,
    ).toBe(true);
    expect(
      addressInputSchema.safeParse({ ...validAddress, address: "a".repeat(501) }).success,
    ).toBe(false);
  });

  it("allows an empty phone (clear) but not an invalid one", () => {
    expect(addressInputSchema.safeParse({ ...validAddress, phone: "" }).success).toBe(true);
    expect(addressInputSchema.safeParse({ ...validAddress, phone: "999" }).success).toBe(false);
  });
});

describe("measurementInputSchema (mirrors DB CHECKs)", () => {
  it("accepts valid values and empties", () => {
    expect(measurementInputSchema.safeParse(validMeasurement).success).toBe(true);
  });

  it("rejects non-positive, non-numeric, and post-round out-of-range values", () => {
    expect(measurementInputSchema.safeParse({ ...validMeasurement, bust: "0" }).success).toBe(
      false,
    );
    expect(measurementInputSchema.safeParse({ ...validMeasurement, bust: "abc" }).success).toBe(
      false,
    );
    // 199.99 rounds to 200.0 at the column scale → DB CHECK (<200) would fire
    expect(measurementInputSchema.safeParse({ ...validMeasurement, bust: "199.99" }).success).toBe(
      false,
    );
    expect(measurementInputSchema.safeParse({ ...validMeasurement, bust: "199.9" }).success).toBe(
      true,
    );
  });

  it("bounds the name at 80 and requires the fit enum", () => {
    expect(
      measurementInputSchema.safeParse({ ...validMeasurement, name: "n".repeat(81) }).success,
    ).toBe(false);
    expect(
      measurementInputSchema.safeParse({ ...validMeasurement, fitPreference: "Baggy" }).success,
    ).toBe(false);
    expect(FIT_PREFERENCE_VALUES).toEqual(["Fitted", "Regular", "Relaxed"]);
  });
});

describe("accountIdSchema / importPayloadSchema", () => {
  it("requires a uuid id", () => {
    expect(accountIdSchema.safeParse({ id: UUID }).success).toBe(true);
    expect(accountIdSchema.safeParse({ id: "nope" }).success).toBe(false);
  });

  it("bounds the import payload but stays loose (RPC salvages row-by-row)", () => {
    expect(importPayloadSchema.safeParse({}).success).toBe(true);
    expect(
      importPayloadSchema.safeParse({
        profile: { fullName: "G", phone: "garbage", birthday: "also garbage" },
        addresses: [{ recipient: "R" }],
        measurements: [{ name: "M", bust: "not-a-number" }],
      }).success,
    ).toBe(true);
    expect(
      importPayloadSchema.safeParse({ addresses: Array(21).fill({ recipient: "R" }) }).success,
    ).toBe(false);
  });
});

describe("RPC payload builders (camel → snake, '' → null clears)", () => {
  it("toProfilePatch preserves key presence", () => {
    expect(toProfilePatch({})).toEqual({});
    expect(toProfilePatch({ phone: "" })).toEqual({ phone: null });
    expect(toProfilePatch({ fullName: "R", birthday: "1992-03-04" })).toEqual({
      full_name: "R",
      birthday: "1992-03-04",
    });
  });

  it("toAddressPayload maps snake keys and clears empties", () => {
    const p = toAddressPayload({ ...validAddress, phone: "", isDefault: true });
    expect(p).toEqual({
      label: null,
      recipient: "Rina Akter",
      phone: null,
      district: "Dhaka",
      area: "Dhanmondi",
      address: "House 1, Road 2",
      is_default: true,
    });
  });

  it("toMeasurementPayload maps dressLength → dress_length", () => {
    const p = toMeasurementPayload(validMeasurement);
    expect(p.dress_length).toBeNull();
    expect(p.bust).toBe("36.5");
    expect(p.fit_preference).toBe("Fitted");
  });

  it("toImportPayload passes rows through with snake keys", () => {
    const p = toImportPayload({
      profile: { fullName: "G" },
      addresses: [{ recipient: "R", isDefault: true }],
      measurements: [{ name: "M", dressLength: "40" }],
    }) as {
      profile: Record<string, unknown>;
      addresses: Record<string, unknown>[];
      measurements: Record<string, unknown>[];
    };
    expect(p.profile.full_name).toBe("G");
    expect(p.addresses[0].is_default).toBe(true);
    expect(p.measurements[0].dress_length).toBe("40");
  });
});

describe("row mappers (defensive; RPC snake rows → UI-shaped DTOs)", () => {
  it("maps a profile row; null/invalid → null", () => {
    expect(
      mapProfileRow({ full_name: "Rina", phone: null, birthday: "1992-03-04", updated_at: "t" }),
    ).toEqual({ fullName: "Rina", phone: "", birthday: "1992-03-04", updatedAt: "t" });
    expect(mapProfileRow(null)).toBeNull();
    expect(mapProfileRow({ full_name: "" })).toBeNull();
  });

  it("maps address rows; drops rows missing required fields", () => {
    const row = mapAddressRow({
      id: UUID,
      label: null,
      recipient: "R",
      phone: null,
      district: "Dhaka",
      area: "A",
      address: "H",
      is_default: true,
    });
    expect(row).toEqual({
      id: UUID,
      label: undefined,
      recipient: "R",
      phone: "",
      district: "Dhaka",
      area: "A",
      address: "H",
      isDefault: true,
    });
    expect(mapAddressRow({ id: UUID, recipient: "" })).toBeNull();
  });

  it("maps measurement rows; numerics become strings, nulls become ''", () => {
    const row = mapMeasurementRow({
      id: UUID,
      name: "Everyday",
      bust: 36.5,
      waist: null,
      hip: null,
      shoulder: null,
      sleeve: null,
      dress_length: 40,
      fit_preference: "Fitted",
      updated_at: "t",
    });
    expect(row?.bust).toBe("36.5");
    expect(row?.waist).toBe("");
    expect(row?.dressLength).toBe("40");
    expect(row?.fitPreference).toBe("Fitted");
    // unknown fit degrades to Regular, never crashes
    expect(mapMeasurementRow({ id: UUID, name: "X", fit_preference: "?" })?.fitPreference).toBe(
      "Regular",
    );
  });

  it("maps the composite snapshot and degrades malformed payloads", () => {
    const snap = mapAccountSnapshot({
      email: "a@b.c",
      profile: null,
      addresses: [{ id: UUID, recipient: "R", district: "D", area: "A", address: "H" }, "junk"],
      measurements: "junk",
    });
    expect(snap.email).toBe("a@b.c");
    expect(snap.profile).toBeNull();
    expect(snap.addresses).toHaveLength(1);
    expect(snap.measurements).toEqual([]);
    expect(mapAccountSnapshot(undefined)).toEqual({
      email: "",
      profile: null,
      addresses: [],
      measurements: [],
    });
  });

  it("maps the import result counts", () => {
    expect(
      mapImportResult({
        profile: true,
        addresses: 2,
        addresses_skipped: 1,
        measurements: 1,
        measurements_skipped: 2,
      }),
    ).toEqual({
      profile: true,
      addresses: 2,
      addressesSkipped: 1,
      measurements: 1,
      measurementsSkipped: 2,
    });
    expect(mapImportResult(null).addresses).toBe(0);
  });
});

describe("stable error codes", () => {
  it("covers every code the account RPCs raise", () => {
    const rpcCodes = [
      "actor_not_authorized",
      "invalid_profile",
      "invalid_phone",
      "invalid_birthday",
      "invalid_address",
      "address_not_found",
      "too_many_addresses",
      "invalid_measurement",
      "measurement_not_found",
      "too_many_measurements",
      "duplicate_measurement_name",
      "already_imported",
      "wishlist_full",
      "product_not_found",
      "internal_error",
    ];
    for (const code of rpcCodes) {
      expect(KNOWN_ACCOUNT_ERROR_CODES.has(code)).toBe(true);
      expect(ACCOUNT_ERROR_MESSAGES[code]).toBeTruthy();
    }
  });

  it("falls back to a generic message for unknown codes", () => {
    expect(accountErrorMessage("weird_code")).toMatch(/try again/i);
    expect(accountErrorMessage(null)).toMatch(/try again/i);
    expect(accountErrorMessage("too_many_addresses")).toContain(String(MAX_SAVED_ADDRESSES));
    expect(accountErrorMessage("too_many_measurements")).toContain(String(MAX_SAVED_MEASUREMENTS));
  });

  it("phone regex matches the DB CHECK exactly", () => {
    expect(BD_PHONE_RE.test("01712345678")).toBe(true);
    expect(BD_PHONE_RE.test("01212345678")).toBe(false);
    expect(BD_PHONE_RE.test("017123456789")).toBe(false);
  });
});

describe("wishlist (P6)", () => {
  it("sanitizeWishlistCodes salvages a device list without ever throwing", () => {
    expect(
      sanitizeWishlistCodes(["p1", "  p2  ", "", "   ", "p1", 7, null, "x".repeat(65), "p3"]),
    ).toEqual(["p1", "p2", "p3"]);
    expect(sanitizeWishlistCodes("junk")).toEqual([]);
    expect(sanitizeWishlistCodes(undefined)).toEqual([]);
    // clamps to the sync payload bound
    const big = Array.from({ length: WISHLIST_SYNC_MAX_CODES + 50 }, (_, i) => `c${i}`);
    expect(sanitizeWishlistCodes(big)).toHaveLength(WISHLIST_SYNC_MAX_CODES);
  });

  it("wishlistSyncSchema mirrors the RPC bounds", () => {
    expect(wishlistSyncSchema.parse({ codes: [" p1 ", "p2"] }).codes).toEqual(["p1", "p2"]);
    expect(wishlistSyncSchema.parse({ codes: [] }).codes).toEqual([]);
    expect(wishlistSyncSchema.safeParse({ codes: [""] }).success).toBe(false);
    expect(wishlistSyncSchema.safeParse({ codes: ["x".repeat(65)] }).success).toBe(false);
    expect(
      wishlistSyncSchema.safeParse({
        codes: Array.from({ length: WISHLIST_SYNC_MAX_CODES + 1 }, (_, i) => `c${i}`),
      }).success,
    ).toBe(false);
  });

  it("wishlistToggleSchema requires one plausible code", () => {
    expect(wishlistToggleSchema.parse({ code: " p1 " }).code).toBe("p1");
    expect(wishlistToggleSchema.safeParse({ code: "" }).success).toBe(false);
    expect(wishlistToggleSchema.safeParse({ code: "x".repeat(65) }).success).toBe(false);
  });

  it("maps RPC snapshots defensively", () => {
    expect(mapWishlistCodes({ codes: ["p1", "", 3, "p2"], count: 2 })).toEqual(["p1", "p2"]);
    expect(mapWishlistCodes({ codes: "junk" })).toEqual([]);
    expect(mapWishlistCodes(null)).toEqual([]);
    expect(mapWishlistToggle({ wishlisted: true, codes: ["p1"], count: 1 })).toEqual({
      wishlisted: true,
      codes: ["p1"],
    });
    expect(mapWishlistToggle(undefined)).toEqual({ wishlisted: false, codes: [] });
  });

  it("cap messages reference the real cap", () => {
    expect(accountErrorMessage("wishlist_full")).toContain(String(MAX_WISHLIST_ITEMS));
    expect(accountErrorMessage("product_not_found")).toBeTruthy();
  });
});
