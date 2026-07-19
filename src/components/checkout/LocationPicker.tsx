/**
 * Cascading Bangladesh address picker: Division → District → Thana/Upazila →
 * Area/Union.
 *
 * Replaces the old split where Dhaka got a curated area dropdown and every
 * other district got a free-text "thana" box — which is why addresses outside
 * Dhaka reached the courier unstructured.
 *
 * Deliberately reports NAMES, not ids, to its parent. The order schema stores
 * ship_district / ship_area as text and the shipping fee tier is derived from
 * the district name, so emitting names keeps submission, validation, saved
 * addresses and pricing working exactly as before — this is a swap of input
 * controls, not a data-model change. Ids stay internal to the cascade.
 *
 * Levels load lazily (one fetch per selection). The full tree is ~5k rural rows
 * plus ~22k metropolitan areas; bundling it would cost more than the entire
 * storefront.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SelectOption } from "@/components/checkout/SearchableSelect";
import {
  listAreasFn,
  listDistrictsFn,
  listDivisionsFn,
  listThanasFn,
  resolveLocationFn,
} from "@/lib/locations.api";
import {
  LOCATION_LABELS,
  LOCATION_PLACEHOLDERS,
  locationLabel,
  type AreaOption,
  type DistrictOption,
  type LocationOption,
  type ThanaOption,
} from "@/lib/locations-shared";

export interface LocationSelection {
  district: string;
  /** Thana (metropolitan) or upazila (rural) name. */
  thana: string;
  /** Area (metropolitan) or union (rural) name — the finest level chosen. */
  area: string;
}

interface Props {
  value: LocationSelection;
  onChange: (next: LocationSelection) => void;
  /** Renders the district field in an error state. */
  districtError?: boolean;
  /** Renders the thana/area fields in an error state. */
  localityError?: boolean;
  disabled?: boolean;
}

export function LocationPicker({ value, onChange, districtError, localityError, disabled }: Props) {
  const [divisions, setDivisions] = useState<LocationOption[]>([]);
  const [districts, setDistricts] = useState<DistrictOption[]>([]);
  const [thanas, setThanas] = useState<ThanaOption[]>([]);
  const [areas, setAreas] = useState<AreaOption[]>([]);

  const [divisionId, setDivisionId] = useState<number | null>(null);
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [thanaId, setThanaId] = useState<number | null>(null);

  const [loading, setLoading] = useState<null | "divisions" | "districts" | "thanas" | "areas">(
    "divisions",
  );

  // ── Level 1 + prefill from a saved address ─────────────────────────────────
  //
  // When the parent already holds a district (a saved address was applied), the
  // cascade must catch up to it — otherwise the customer sees empty dropdowns
  // sitting on populated state and could submit an address they never
  // confirmed. Runs once on mount only: re-resolving on every value change
  // would fight the user's own selections.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await listDivisionsFn();
      if (cancelled) return;
      if (r.success) setDivisions(r.divisions);

      if (value.district) {
        const resolved = await resolveLocationFn({
          data: { district: value.district, thana: value.thana || undefined },
        });
        if (cancelled) return;
        if (resolved.success && resolved.districtId != null) {
          setDivisionId(resolved.divisionId);
          setDistrictId(resolved.districtId);
          setThanaId(resolved.thanaId);
        }
      }
      setLoading(null);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only prefill
  }, []);

  // ── Level 2 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (divisionId == null) {
      setDistricts([]);
      return;
    }
    let cancelled = false;
    setLoading("districts");
    void (async () => {
      const r = await listDistrictsFn({ data: { divisionId } });
      if (cancelled) return;
      setDistricts(r.success ? r.districts : []);
      setLoading(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [divisionId]);

  // ── Level 3 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (districtId == null) {
      setThanas([]);
      return;
    }
    let cancelled = false;
    setLoading("thanas");
    void (async () => {
      const r = await listThanasFn({ data: { districtId } });
      if (cancelled) return;
      setThanas(r.success ? r.thanas : []);
      setLoading(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [districtId]);

  // ── Level 4 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (thanaId == null) {
      setAreas([]);
      return;
    }
    let cancelled = false;
    setLoading("areas");
    void (async () => {
      const r = await listAreasFn({ data: { thanaId } });
      if (cancelled) return;
      setAreas(r.success ? r.areas : []);
      setLoading(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [thanaId]);

  // ── Handlers — each clears everything below it ─────────────────────────────
  const pickDivision = useCallback(
    (v: string) => {
      setDivisionId(Number(v));
      setDistrictId(null);
      setThanaId(null);
      onChange({ district: "", thana: "", area: "" });
    },
    [onChange],
  );

  const pickDistrict = useCallback(
    (v: string) => {
      const idNum = Number(v);
      setDistrictId(idNum);
      setThanaId(null);
      const d = districts.find((x) => x.id === idNum);
      onChange({ district: d?.name ?? "", thana: "", area: "" });
    },
    [districts, onChange],
  );

  const pickThana = useCallback(
    (v: string) => {
      const idNum = Number(v);
      setThanaId(idNum);
      const t = thanas.find((x) => x.id === idNum);
      onChange({ ...value, thana: t?.name ?? "", area: "" });
    },
    [thanas, onChange, value],
  );

  const pickArea = useCallback(
    (v: string) => {
      const idNum = Number(v);
      const a = areas.find((x) => x.id === idNum);
      onChange({ ...value, area: a?.name ?? "" });
    },
    [areas, onChange, value],
  );

  const busy = (which: typeof loading) => loading === which;

  // cmdk matches on the option's value string, so fold the Bengali name in as
  // searchable keywords — a customer typing "ঢাকা" should find Dhaka.
  const toOptions = (
    rows: Array<{ id: number; name: string; bnName: string | null }>,
  ): SelectOption[] =>
    rows.map((r) => ({
      value: String(r.id),
      label: locationLabel(r),
      keywords: r.bnName ?? undefined,
    }));

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={LOCATION_LABELS.division}>
        <SearchableSelect
          options={toOptions(divisions)}
          value={divisionId ? String(divisionId) : undefined}
          onChange={pickDivision}
          placeholder={LOCATION_PLACEHOLDERS.division}
          searchPlaceholder="Search division…"
          disabled={disabled}
          loading={busy("divisions")}
          ariaLabel="Division"
        />
      </Field>

      <Field label={LOCATION_LABELS.district} error={districtError}>
        <SearchableSelect
          id="checkout-district"
          options={toOptions(districts)}
          value={districtId ? String(districtId) : undefined}
          onChange={pickDistrict}
          placeholder={LOCATION_PLACEHOLDERS.district}
          searchPlaceholder="Search district…"
          disabled={disabled || divisionId == null}
          loading={busy("districts")}
          invalid={districtError}
          ariaLabel="District"
        />
      </Field>

      <Field label={LOCATION_LABELS.thana} error={localityError}>
        <SearchableSelect
          id="checkout-locality"
          options={toOptions(thanas)}
          value={thanaId ? String(thanaId) : undefined}
          onChange={pickThana}
          placeholder={LOCATION_PLACEHOLDERS.thana}
          searchPlaceholder="Search thana / upazila…"
          disabled={disabled || districtId == null}
          loading={busy("thanas")}
          invalid={localityError}
          ariaLabel="Thana or Upazila"
        />
      </Field>

      <Field label={LOCATION_LABELS.area} error={localityError}>
        <SearchableSelect
          options={toOptions(areas)}
          value={areas.find((a) => a.name === value.area)?.id?.toString()}
          onChange={pickArea}
          placeholder={LOCATION_PLACEHOLDERS.area}
          searchPlaceholder="Search area / union…"
          disabled={disabled || thanaId == null}
          loading={busy("areas")}
          invalid={localityError}
          ariaLabel="Area or Union"
        />
        {/* A thana with no listed areas is legitimate — some metropolitan zones
            carry none. The thana alone is then the finest location we have, and
            validation accepts it (see localityValue in checkout). */}
        {thanaId != null && !busy("areas") && areas.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            No sub-areas listed — your thana / upazila is enough.
          </p>
        )}
      </Field>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className={error ? "text-destructive" : undefined}>{label}</Label>
      {children}
    </div>
  );
}

/** Spinner for callers that want to show the picker is still warming up. */
export function LocationPickerSkeleton() {
  return (
    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading locations…
    </div>
  );
}
