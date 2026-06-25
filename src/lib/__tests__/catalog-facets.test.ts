import { describe, it, expect } from "vitest";
import {
  normalizeFacets,
  facetValues,
  EMPTY_FACETS,
  type CatalogFacets,
} from "@/lib/catalog-facets";
import { rollupCategoryCounts } from "@/lib/categories";

describe("normalizeFacets", () => {
  it("coerces a well-formed payload", () => {
    const raw = {
      categories: [
        { slug: "kurti", name: "Kurti", count: 3 },
        { slug: "saree", name: "Saree", count: 1 },
      ],
      colors: [
        { value: "Maroon", count: 3 },
        { value: "Ivory", count: 1 },
      ],
      fabrics: [{ value: "Cotton", count: 2 }],
      occasions: [{ value: "Festive", count: 2 }],
    };
    const f = normalizeFacets(raw);
    expect(f.categories).toEqual(raw.categories);
    expect(facetValues(f.colors)).toEqual(["Maroon", "Ivory"]);
    expect(f.fabrics).toEqual([{ value: "Cotton", count: 2 }]);
  });

  it("returns EMPTY_FACETS for non-object / junk input", () => {
    expect(normalizeFacets(null)).toEqual(EMPTY_FACETS);
    expect(normalizeFacets("nope")).toEqual(EMPTY_FACETS);
    expect(normalizeFacets(42)).toEqual(EMPTY_FACETS);
    expect(normalizeFacets(undefined)).toEqual(EMPTY_FACETS);
  });

  it("defaults missing facet groups to empty arrays", () => {
    expect(normalizeFacets({ colors: [{ value: "Rose", count: 1 }] })).toEqual({
      categories: [],
      colors: [{ value: "Rose", count: 1 }],
      fabrics: [],
      occasions: [],
    });
  });

  it("drops malformed entries (missing value/slug, non-positive or non-numeric count)", () => {
    const f = normalizeFacets({
      categories: [
        { slug: "kurti", name: "Kurti", count: 2 },
        { slug: "", name: "Blank", count: 5 }, // no slug
        { slug: "saree", name: "Saree", count: 0 }, // zero count
      ],
      colors: [
        { value: "Maroon", count: 3 },
        { value: "Ghost", count: -1 }, // negative
        { value: "Bad", count: "x" }, // non-numeric
        { count: 2 }, // no value
      ],
    });
    expect(f.categories).toEqual([{ slug: "kurti", name: "Kurti", count: 2 }]);
    expect(f.colors).toEqual([{ value: "Maroon", count: 3 }]);
  });

  it("trims whitespace and falls back name to slug", () => {
    const f = normalizeFacets({
      categories: [{ slug: "  kurti  ", name: "   ", count: 1 }],
      colors: [{ value: "  Maroon  ", count: 1 }],
    });
    expect(f.categories).toEqual([{ slug: "kurti", name: "kurti", count: 1 }]);
    expect(f.colors).toEqual([{ value: "Maroon", count: 1 }]);
  });
});

describe("rollupCategoryCounts", () => {
  const base: CatalogFacets = { ...EMPTY_FACETS };

  it("sums the three cosmetics types into one Cosmetics facet", () => {
    const counts = rollupCategoryCounts({
      ...base,
      categories: [
        { slug: "kurti", name: "Kurti", count: 3 },
        { slug: "saree", name: "Saree", count: 1 },
        { slug: "three-piece", name: "Three Piece", count: 2 },
        { slug: "girls-dress", name: "Girls Dress", count: 1 },
        { slug: "cosmetics", name: "Cosmetics", count: 1 },
        { slug: "makeup", name: "Makeup", count: 1 },
        { slug: "serum", name: "Serum", count: 1 },
      ],
    });
    expect(counts).toEqual({
      kurti: 3,
      saree: 1,
      "three-piece": 2,
      "girls-dress": 1,
      cosmetics: 3, // 1 + 1 + 1
    });
  });

  it("reports 0 for categories with no visible products and ignores unknown slugs", () => {
    const counts = rollupCategoryCounts({
      ...base,
      categories: [
        { slug: "kurti", name: "Kurti", count: 5 },
        { slug: "mystery", name: "Mystery", count: 9 }, // unknown → ignored
      ],
    });
    expect(counts).toEqual({
      kurti: 5,
      saree: 0,
      "three-piece": 0,
      "girls-dress": 0,
      cosmetics: 0,
    });
  });
});
