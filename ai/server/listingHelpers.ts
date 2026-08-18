import { CATEGORIES } from "../../src/constants.js";
import {
  getListingSubcategories,
  getListingItemTypes,
} from "../../src/listingSchemas/index.js";

export type AsyncRouteHandler = (
  req: unknown,
  res: unknown,
  next: unknown,
) => Promise<unknown>;

export const TITLE_MIN_ALNUM_CHARS = 3;
const SPEC_FILTER_KEY_PATTERN = /^[A-Za-z0-9_]+$/;

export function withAsyncRoute<TReq = any, TRes = any, TNext = any>(
  handler: (req: TReq, res: TRes, next: TNext) => Promise<unknown>,
) {
  return (req: TReq, res: TRes, next: TNext) => {
    void handler(req, res, next).catch(next as any);
  };
}

export function isMeaningfulTitle(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (trimmed.length < 3) return false;

  const alnumMatches = trimmed.match(/[a-zA-Z0-9]/g) ?? [];
  if (alnumMatches.length < TITLE_MIN_ALNUM_CHARS) return false;

  const uniqueChars = new Set(trimmed.toLowerCase().replace(/\s+/g, ""));
  return uniqueChars.size >= 2;
}

export function isValidListingHierarchy(
  category: string,
  subcategory?: string | null,
  itemType?: string | null,
): boolean {
  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return false;
  }

  const safeSubcategory = subcategory?.trim();
  const safeItemType = itemType?.trim();

  if (!safeSubcategory && !safeItemType) {
    return true;
  }

  if (!safeSubcategory || !safeItemType) {
    return false;
  }

  const validSubcategories = getListingSubcategories(category);
  if (!validSubcategories.includes(safeSubcategory)) {
    return false;
  }

  const validItemTypes = getListingItemTypes(category, safeSubcategory);
  return validItemTypes.includes(safeItemType);
}

type IncomingSpecFilters = Record<string, unknown>;

export function parseSpecFilters(
  raw: unknown,
): Record<string, string | string[] | boolean> {
  if (typeof raw !== "string" || !raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as IncomingSpecFilters;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const safe: Record<string, string | string[] | boolean> = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (!key || key.length > 120 || !SPEC_FILTER_KEY_PATTERN.test(key)) {
        continue;
      }

      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) {
          safe[key] = trimmed;
        }
        continue;
      }

      if (typeof value === "boolean") {
        safe[key] = value;
        continue;
      }

      if (Array.isArray(value)) {
        const cleaned = value
          .filter((item) => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
          .slice(0, 25);

        if (cleaned.length > 0) {
          safe[key] = cleaned;
        }
      }
    }

    return safe;
  } catch {
    return {};
  }
}

export type NormalizedListingPricing = {
  price: number;
  original_price: number | null;
  discount_percent: number | null;
  deal_label: string | null;
  deal_expires_at: string | null;
  can_sell_individually: number | null;
  single_item_price: number | null;
  is_wholesale: number;
  pack_size: number | null;
  bulk_units: string | null;
  listing_mode: "normal" | "deal" | "wholesale";
};

export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toBooleanFlag(value: unknown): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value !== 0 ? 1 : 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["true", "1", "yes", "y", "on"].includes(normalized) ? 1 : 0;
  }
  return 0;
}

export function computeOriginalPrice(
  price: number,
  discountPercent: number | null,
) {
  if (
    discountPercent === null ||
    discountPercent <= 0 ||
    discountPercent >= 100
  ) {
    return null;
  }

  const computed = price / (1 - discountPercent / 100);
  return Number.isFinite(computed) && computed > price
    ? Number(computed.toFixed(2))
    : null;
}

export function normalizeListingPricing(
  body: any,
  existingListingMode?: "normal" | "deal" | "wholesale",
): NormalizedListingPricing {
  const price = toFiniteNumber(body.price) ?? 0;
  const originalPriceInput = toFiniteNumber(body.original_price);
  const discountPercentInput = toFiniteNumber(body.discount_percent);
  const isWholesale = toBooleanFlag(body.is_wholesale);
  const packSize = toFiniteNumber(body.pack_size);
  const bulkUnits = toTrimmedString(body.bulk_units);
  const singleItemPriceInput = toFiniteNumber(body.single_item_price);
  const dealLabel = toTrimmedString(body.deal_label);
  const dealExpiresAt = toTrimmedString(body.deal_expires_at);
  const canSellIndividually =
    body.can_sell_individually === null || body.can_sell_individually === undefined
      ? null
      : toBooleanFlag(body.can_sell_individually);

  const rawMode = toTrimmedString(body.listing_mode)?.toLowerCase();

  const legacyDerivedMode =
    isWholesale
      ? "wholesale"
      : originalPriceInput !== null
        ? "deal"
        : undefined;

  const listing_mode: "normal" | "deal" | "wholesale" =
    rawMode === "deal" || rawMode === "wholesale"
      ? rawMode
      : legacyDerivedMode ?? existingListingMode ?? "normal";

  const discount_percent = null;
  const original_price =
    listing_mode === "deal" &&
    originalPriceInput !== null &&
    originalPriceInput > price
      ? originalPriceInput
      : null;
  const deal_label = listing_mode === "deal" ? dealLabel : null;
  const deal_expires_at = listing_mode === "deal" ? dealExpiresAt : null;
  const wholesaleFlag = listing_mode === "wholesale" ? 1 : 0;
  const can_sell_individually =
    listing_mode === "wholesale" ? canSellIndividually : null;
  const single_item_price =
    listing_mode === "wholesale" &&
    canSellIndividually === 1 &&
    singleItemPriceInput !== null &&
    singleItemPriceInput > 0
      ? singleItemPriceInput
      : null;
  const safePackSize = listing_mode === "wholesale" ? packSize : null;
  const safeBulkUnits = listing_mode === "wholesale" ? bulkUnits : null;

  return {
    price,
    original_price,
    discount_percent,
    deal_label,
    deal_expires_at,
    can_sell_individually,
    single_item_price,
    is_wholesale: wholesaleFlag,
    pack_size: safePackSize,
    bulk_units: safeBulkUnits,
    listing_mode,
  };
}

export function serializeListingRow(row: any) {
  return {
    ...row,
    price: Number(row.price ?? 0),
    original_price:
      row.original_price === null || row.original_price === undefined
        ? null
        : Number(row.original_price),
    discount_percent:
      row.discount_percent === null || row.discount_percent === undefined
        ? null
        : Number(row.discount_percent),
    is_wholesale: Boolean(row.is_wholesale),
    pack_size:
      row.pack_size === null || row.pack_size === undefined
        ? null
        : Number(row.pack_size),
    bulk_units:
      typeof row.bulk_units === "string" && row.bulk_units.trim()
        ? row.bulk_units.trim()
        : null,
    listing_mode:
      typeof row.listing_mode === "string" && row.listing_mode.trim()
        ? row.listing_mode.trim()
        : "normal",
    deal_expires_at:
      typeof row.deal_expires_at === "string" && row.deal_expires_at.trim()
        ? row.deal_expires_at.trim()
        : null,
    can_sell_individually:
      row.can_sell_individually === null || row.can_sell_individually === undefined
        ? null
        : Boolean(row.can_sell_individually),
    single_item_price:
      row.single_item_price === null || row.single_item_price === undefined
        ? null
        : Number(row.single_item_price),
    photos: JSON.parse(row.photos || "[]"),
    spec_values: JSON.parse(row.spec_values || "{}"),
  };
}
