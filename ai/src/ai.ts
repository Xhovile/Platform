import { apiFetch } from "./api";
import type { ListingDraft } from "../types";

export type ListingAiDraft = Partial<ListingDraft> & {
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

export type ShoppingAssistantListing = {
  id: string;
  name: string;
  category?: string;
  price: number;
  description?: string;
  condition?: string;
  university?: string;
  location?: string;
};

export type ShoppingAssistantResult = {
  reply: string;
  recommended_listing_ids: string[];
  match_reasons: Record<string, string>;
  suggested_follow_ups: string[];
  recommended_listings: ShoppingAssistantListing[];
};

export type CopilotConversationMessage = {
  role: "user" | "assistant";
  text: string;
};

export type CompareListingsResult = {
  summary: string;
  winner_id: string;
  winner_reason: string;
  item_evaluations: Array<{
    id: string;
    value_score: number;
    pros: string[];
    cons: string[];
    best_for: string;
  }>;
};

export type ContentModerationResult = {
  is_safe: boolean;
  risk_level: "low" | "medium" | "high";
  flags: string[];
  explanation: string;
};

export async function generateListingDraft(currentDraft: Partial<ListingDraft>): Promise<ListingAiDraft> {
  const response = await apiFetch("/api/ai/listing-draft", {
    method: "POST",
    body: JSON.stringify({ currentDraft }),
  });

  return (response?.draft ?? {}) as ListingAiDraft;
}

export async function suggestListingPricing(payload: {
  name: string;
  category: string;
  condition?: string;
  specs?: Record<string, unknown>;
  currentPrice?: number;
}): Promise<PriceSuggestionResult | null> {
  try {
    const response = await apiFetch("/api/ai/suggest-pricing", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return response?.pricing ?? null;
  } catch (err) {
    console.warn("AI suggest pricing failed:", err);
    return null;
  }
}

export async function queryShoppingAssistant(payload: {
  query: string;
  university?: string;
  category?: string;
  maxPrice?: number;
  contextListings?: ShoppingAssistantListing[];
}): Promise<ShoppingAssistantResult | null> {
  try {
    const response = await apiFetch("/api/ai/shopping-assistant", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return response?.result ?? null;
  } catch (err) {
    console.warn("BuyMesho Copilot query failed:", err);
    return null;
  }
}

/** The server owns canonical listing truth for comparisons; clients submit IDs only. */
export async function compareMarketplaceItems(items: Array<{ id: string }>): Promise<CompareListingsResult | null> {
  try {
    const response = await apiFetch("/api/ai/compare-listings", {
      method: "POST",
      body: JSON.stringify({ listingIds: items.map((item) => String(item.id)) }),
    });
    return response?.comparison ?? null;
  } catch (err) {
    console.warn("AI compare listings failed:", err);
    return null;
  }
}

export async function moderateContent(text: string, type: "listing" | "message" = "listing"): Promise<ContentModerationResult | null> {
  try {
    const response = await apiFetch("/api/ai/moderate", {
      method: "POST",
      body: JSON.stringify({ text, type }),
    });
    return response?.moderation ?? null;
  } catch (err) {
    console.warn("AI Content moderation failed:", err);
    return null;
  }
}
