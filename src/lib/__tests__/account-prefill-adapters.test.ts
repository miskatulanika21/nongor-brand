/**
 * Stage 4 P5 — prefill adapters bridging saved account data and the two
 * consumer surfaces (checkout address form, PDP custom-size form).
 */
import { describe, it, expect } from "vitest";
import {
  measurementProfileToCustomSize,
  customSizeToMeasurementValues,
  checkoutAddressMatchesSaved,
  savedAddressToCheckoutAddress,
  type MeasurementProfile,
  type SavedAddress,
} from "@/lib/account-ui";
import { toDisplayMeasurements } from "@/lib/measurements";

const PROFILE: MeasurementProfile = {
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

const SAVED: SavedAddress = {
  id: "a1",
  label: "Home",
  recipient: "Amina Rahman",
  phone: "01712345678",
  district: "Dhaka",
  area: "Gulshan",
  address: "House 1, Road 2",
  isDefault: true,
};

describe("saved profile → PDP form (prefill direction)", () => {
  it("maps a full profile to the PDP display keys, dressLength → Kurti Length", () => {
    const display = toDisplayMeasurements(measurementProfileToCustomSize(PROFILE));
    expect(display).toEqual({
      Bust: "34",
      Waist: "28",
      Hip: "36",
      Shoulder: "14",
      Sleeve: "22",
      "Kurti Length": "44",
    });
  });

  it("omits empty and non-positive values instead of writing blanks", () => {
    const partial = { ...PROFILE, sleeve: "", hip: "0" };
    const display = toDisplayMeasurements(measurementProfileToCustomSize(partial));
    expect(display).not.toHaveProperty("Sleeve");
    expect(display).not.toHaveProperty("Hip");
    expect(display.Bust).toBe("34");
  });
});

describe("PDP form → account payload (save-back direction)", () => {
  it("maps display keys to measurement values, Kurti Length → dressLength", () => {
    const values = customSizeToMeasurementValues({
      Bust: "34.5",
      Waist: "28",
      Hip: "36",
      Shoulder: "14",
      Sleeve: "22",
      "Kurti Length": "44",
    });
    expect(values).toEqual({
      bust: "34.5",
      waist: "28",
      hip: "36",
      shoulder: "14",
      sleeve: "22",
      dressLength: "44",
    });
  });

  it("coerces missing/invalid entries to '' (the RPC's clear semantics)", () => {
    const values = customSizeToMeasurementValues({ Bust: "abc", Waist: "-2" });
    expect(values).toEqual({
      bust: "",
      waist: "",
      hip: "",
      shoulder: "",
      sleeve: "",
      dressLength: "",
    });
  });

  it("round-trips a profile through the PDP form unchanged", () => {
    const display = toDisplayMeasurements(measurementProfileToCustomSize(PROFILE));
    const values = customSizeToMeasurementValues(display);
    expect(values).toEqual({
      bust: PROFILE.bust,
      waist: PROFILE.waist,
      hip: PROFILE.hip,
      shoulder: PROFILE.shoulder,
      sleeve: PROFILE.sleeve,
      dressLength: PROFILE.dressLength,
    });
  });
});

describe("checkout save-back dedupe", () => {
  it("matches the checkout form derived from the same saved address", () => {
    expect(checkoutAddressMatchesSaved(savedAddressToCheckoutAddress(SAVED), SAVED)).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    const form = {
      recipient: "  amina rahman ",
      phone: "01712345678",
      district: "dhaka",
      area: "GULSHAN",
      address: "house 1, road 2  ",
    };
    expect(checkoutAddressMatchesSaved(form, SAVED)).toBe(true);
  });

  it("does not match when any field differs", () => {
    const form = savedAddressToCheckoutAddress(SAVED);
    expect(checkoutAddressMatchesSaved({ ...form, address: "House 9" }, SAVED)).toBe(false);
    expect(checkoutAddressMatchesSaved({ ...form, phone: "01812345678" }, SAVED)).toBe(false);
  });
});
