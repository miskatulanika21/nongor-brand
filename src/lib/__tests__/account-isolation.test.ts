import { describe, it, expect, beforeEach } from "vitest";
import {
  readProfile,
  writeProfile,
  readAddresses,
  writeAddresses,
  readMeasurements,
  writeMeasurements,
  purgeLegacyAccountKeys,
  DEFAULT_PROFILE,
} from "@/lib/account-ui";

const A = "user-aaaa";
const B = "user-bbbb";

describe("account PII isolation (F-03)", () => {
  beforeEach(() => localStorage.clear());

  it("does not leak one user's profile to another account on the same browser", () => {
    writeProfile(A, { ...DEFAULT_PROFILE, name: "Alice", phone: "01700000001" });
    // A different signed-in user starts from defaults, not Alice's data.
    expect(readProfile(B)).toEqual(DEFAULT_PROFILE);
    expect(readProfile(A).name).toBe("Alice");
  });

  it("isolates addresses and measurements per user", () => {
    writeAddresses(A, [
      {
        id: "x",
        recipient: "Alice",
        phone: "01700000001",
        district: "Dhaka",
        area: "Gulshan",
        address: "Road 1",
        isDefault: true,
      },
    ]);
    writeMeasurements(A, [
      {
        id: "m",
        name: "Mine",
        bust: "34",
        waist: "28",
        hip: "36",
        shoulder: "",
        sleeve: "",
        dressLength: "",
        fitPreference: "Regular",
        updatedAt: new Date().toISOString(),
      },
    ]);
    expect(readAddresses(B)).toEqual([]);
    expect(readMeasurements(B)).toEqual([]);
    expect(readAddresses(A)).toHaveLength(1);
    expect(readMeasurements(A)).toHaveLength(1);
  });

  it("purges legacy unscoped keys so they cannot leak to the current account", () => {
    localStorage.setItem(
      "nongorr_account_profile",
      JSON.stringify({ version: 1, data: { name: "Stale", email: "", phone: "", birthday: "" } }),
    );
    purgeLegacyAccountKeys();
    expect(localStorage.getItem("nongorr_account_profile")).toBeNull();
    // The current user still reads from their own (empty) partition.
    expect(readProfile(A)).toEqual(DEFAULT_PROFILE);
  });
});
