import { generateGeminiJson } from "./gemini.js";

export type ListingDraftSuggestion = {
  name?: string;
  description?: string;
  category?: string;
  subcategory?: string;
  item_type?: string;
  condition?: string;
  university?: string;
  price?: number | null;
  quantity?: number | null;
  listing_mode?: string;
  original_price?: number | null;
  discount_percent?: number | null;
  deal_label?: string | null;
  deal_expires_at?: string | null;
  is_wholesale?: boolean | null;
  can_sell_individually?: boolean | null;
  pack_size?: number | null;
  bulk_units?: string | null;
  single_item_price?: number | null;
  spec_values?: Record<string, unknown>;
  notes?: string[];
  suggested_tags?: string[];
};

export type PriceSuggestionResult = {
  min_price: number;
  max_price: number;
  recommended_price: number;
  deal_rating: "bargain" | "fair" | "premium";
  confidence_score: number;
  market_insight: string;
  pricing_tips: string[];
  evidence_source?: "marketplace_comparables" | "ai_only" | "insufficient_data";
  comparable_count?: number;
};

export type ContentModerationResult = {
  is_safe: boolean;
  risk_level: "low" | "medium" | "high";
  flags: string[];
  explanation: string;
};

const LISTING_DRAFT_INSTRUCTION = [
  "You are BuyMesho Listing Studio for a marketplace in Malawi.",
  "Enhance the seller's existing draft into a clear, accurate listing.",
  "Preserve every user-provided fact unless it is clearly contradictory or unsafe.",
  "Never invent a price, quantity, category, condition, university, specification, or product fact.",
  "Only return fields that can be supported by the supplied draft; omit unknown fields rather than guessing.",
  "Prices are in Malawian Kwacha (MWK).",
  "Return JSON only with: name, description, category, subcategory, item_type, condition, university, price, quantity, listing_mode, original_price, discount_percent, deal_label, deal_expires_at, is_wholesale, can_sell_individually, pack_size, bulk_units, single_item_price, spec_values, notes, suggested_tags.",
].join(" ");

const PRICING_INSTRUCTION = [
  "You are BuyMesho Pricing Assistant.",
  "Provide a pricing suggestion for a BuyMesho listing in Malawi using supplied product information and supplied BuyMesho comparable listings when present.",
  "This is AI decision support, not an authoritative market valuation.",
  "Do not claim to have current market, transaction, or comparable-listing data unless it is explicitly supplied in the request.",
  "If comparable_count is 0 and the product information is insufficient to make a defensible estimate, return confidence_score 0 and explain the missing information in market_insight instead of inventing a price.",
  "When comparable listings are supplied, ground the price range in those BuyMesho listing prices and explain that evidence in market_insight.",
  "Return JSON with min_price, max_price, recommended_price, deal_rating (bargain|fair|premium), confidence_score (0-100), market_insight, pricing_tips, evidence_source, comparable_count.",
  "All prices must be MWK and numeric.",
].join(" ");

const MODERATION_INSTRUCTION = [
  "You are BuyMesho Trust & Safety Moderator.",
  "Analyze the supplied listing or message for safety and marketplace policy risks.",
  "Flag prohibited or suspicious activity including weapons, drugs, counterfeit goods, payment phishing, academic fraud, scams, harassment, and attempts to move transactions off-platform when relevant.",
  "Do not assume content is safe when analysis fails; failures must be surfaced to the caller.",
  "Return JSON with is_safe, risk_level (low|medium|high), flags (array of strings), and explanation.",
].join(" ");

export async function generateListingDraft(currentDraft: Record<string, unknown>): Promise<ListingDraftSuggestion> {
  return generateGeminiJson<ListingDraftSuggestion>({
    systemInstruction: LISTING_DRAFT_INSTRUCTION,
    payload: { currentDraft },
  });
}

function loadPricingComparables(db: any, input: { name: string; category: string; condition?: string }): Array<{ id: string; name: string; category?: string; condition?: string; price: number }> {
  if (!db) return [];
  const terms = input.name.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((term) => term.length >= 3).slice(0, 4);
  const params: unknown[] = [input.category];
  let where = "WHERE is_hidden = 0 AND deleted_at IS NULL AND status != 'sold' AND category = ?";

  if (input.condition) {
    where += " AND condition = ?";
    params.push(input.condition);
  }

  if (terms.length > 0) {
    where += ` AND (${terms.map(() => "LOWER(name) LIKE ?").join(" OR ")})`;
    params.push(...terms.map((term) => `%${term}%`));
  }

  const rows = db.prepare(`
    SELECT id, name, category, condition, price
    FROM listings
    ${where}
    ORDER BY created_at DESC
    LIMIT 12
  `).all(...params) as Array<Record<string, unknown>>;

  return rows
    .map((row) => ({
      id: String(row.id),
      name: String(row.name ?? "").slice(0, 160),
      category: typeof row.category === "string" ? row.category.slice(0, 100) : undefined,
      condition: typeof row.condition === "string" ? row.condition.slice(0, 100) : undefined,
      price: Number(row.price),
    }))
    .filter((row) => Number.isFinite(row.price) && row.price > 0);
}

export async function suggestPricing(input: {
  name: string;
  category: string;
  condition?: string;
  specs?: Record<string, unknown>;
  currentPrice?: number;
  db?: any;
}): Promise<PriceSuggestionResult> {
  const comparable_listings = loadPricingComparables(input.db, input);
  const result = await generateGeminiJson<PriceSuggestionResult>({
    systemInstruction: PRICING_INSTRUCTION,
    payload: { ...input, db: undefined, comparable_count: comparable_listings.length, comparable_listings },
  });

  return {
    ...result,
    evidence_source: comparable_listings.length > 0 ? "marketplace_comparables" : result.confidence_score > 0 ? "ai_only" : "insufficient_data",
    comparable_count: comparable_listings.length,
  };
}

export async function moderateContent(input: {
  text: string;
  type: "listing" | "message";
}): Promise<ContentModerationResult> {
  return generateGeminiJson<ContentModerationResult>({
    systemInstruction: MODERATION_INSTRUCTION,
    payload: input,
  });
}
