import type { Express, RequestHandler } from "express";
import { compareBuyMeshoListings } from "../lib/listing-comparison.js";
import { shoppingAssistant } from "../lib/shopping-assistant.js";
import {
  generateListingDraft,
  suggestPricing,
  moderateContent,
} from "../lib/listing-ai-studio.js";
import {
  authenticatedAiRateLimit,
  publicAiRateLimit,
} from "../middleware/aiRateLimit.js";

const MAX_TEXT_LENGTH = 8_000;
const MAX_DRAFT_KEYS = 40;
const MAX_CONTEXT_LISTINGS = 30;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function registerAiRoutes(app: Express, requireFirebaseUser: RequestHandler, db?: any) {
  // Authenticated seller tooling. Rate-limit after auth so the per-user key can be used.
  app.post("/api/ai/listing-draft", requireFirebaseUser, authenticatedAiRateLimit, async (req, res) => {
    try {
      const currentDraft = req.body?.currentDraft;
      if (!isPlainObject(currentDraft)) {
        return res.status(400).json({ error: "currentDraft object is required" });
      }
      if (Object.keys(currentDraft).length > MAX_DRAFT_KEYS) {
        return res.status(400).json({ error: "currentDraft contains too many fields" });
      }

      const draft = await generateListingDraft(currentDraft);
      return res.json({ draft });
    } catch (error) {
      console.error("AI Listing Draft error:", error);
      const message = error instanceof Error ? error.message : "AI listing enhancement is currently unavailable";
      return res.status(503).json({ error: message, code: "AI_UNAVAILABLE" });
    }
  });

  app.post("/api/ai/suggest-pricing", requireFirebaseUser, authenticatedAiRateLimit, async (req, res) => {
    try {
      const { name, category, condition, specs, currentPrice } = req.body || {};
      if (typeof name !== "string" || !name.trim() || name.length > 300) {
        return res.status(400).json({ error: "name is required and must be 300 characters or fewer" });
      }
      if (typeof category !== "string" || !category.trim() || category.length > 150) {
        return res.status(400).json({ error: "category is required and must be 150 characters or fewer" });
      }
      if (condition !== undefined && (typeof condition !== "string" || condition.length > 100)) {
        return res.status(400).json({ error: "condition must be a string of 100 characters or fewer" });
      }
      if (specs !== undefined && !isPlainObject(specs)) {
        return res.status(400).json({ error: "specs must be an object" });
      }
      if (currentPrice !== undefined && (typeof currentPrice !== "number" || !Number.isFinite(currentPrice) || currentPrice < 0)) {
        return res.status(400).json({ error: "currentPrice must be a non-negative number" });
      }

      const pricing = await suggestPricing({ name, category, condition, specs, currentPrice, db });
      return res.json({ pricing });
    } catch (error) {
      console.error("AI Suggest Pricing error:", error);
      const message = error instanceof Error ? error.message : "AI pricing suggestions are currently unavailable";
      return res.status(503).json({ error: message, code: "AI_UNAVAILABLE" });
    }
  });

  // Public discovery endpoint. The database is authoritative for candidate listings;
  // client-supplied context can only narrow the candidate set.
  app.post("/api/ai/shopping-assistant", publicAiRateLimit, async (req, res) => {
    try {
      const { query, university, category, maxPrice, contextListings } = req.body || {};
      if (typeof query !== "string" || !query.trim() || query.length > MAX_TEXT_LENGTH) {
        return res.status(400).json({ error: "query is required and must be 8,000 characters or fewer" });
      }
      if (university !== undefined && (typeof university !== "string" || university.length > 150)) {
        return res.status(400).json({ error: "university must be a string of 150 characters or fewer" });
      }
      if (category !== undefined && (typeof category !== "string" || category.length > 150)) {
        return res.status(400).json({ error: "category must be a string of 150 characters or fewer" });
      }
      if (maxPrice !== undefined && (typeof maxPrice !== "number" || !Number.isFinite(maxPrice) || maxPrice < 0)) {
        return res.status(400).json({ error: "maxPrice must be a non-negative number" });
      }
      if (contextListings !== undefined && (!Array.isArray(contextListings) || contextListings.length > MAX_CONTEXT_LISTINGS)) {
        return res.status(400).json({ error: `contextListings must contain at most ${MAX_CONTEXT_LISTINGS} items` });
      }

      const result = await shoppingAssistant({
        query,
        university: typeof university === "string" ? university : undefined,
        category: typeof category === "string" ? category : undefined,
        maxPrice: typeof maxPrice === "number" ? maxPrice : undefined,
        contextListings: Array.isArray(contextListings) ? contextListings : [],
        db,
      });

      return res.json({ result });
    } catch (error) {
      console.error("BuyMesho Copilot error:", error);
      const message = error instanceof Error ? error.message : "BuyMesho Copilot is currently unavailable";
      return res.status(503).json({ error: message, code: "COPILOT_UNAVAILABLE" });
    }
  });

  // Public comparison endpoint. Only canonical BuyMesho listing IDs are accepted.
  app.post("/api/ai/compare-listings", publicAiRateLimit, async (req, res) => {
    try {
      const { listingIds } = req.body || {};
      if (!Array.isArray(listingIds) || listingIds.length < 2 || listingIds.length > 3) {
        return res.status(400).json({ error: "Between 2 and 3 listingIds are required for comparison" });
      }

      const normalizedIds = listingIds.map((id) => String(id).trim());
      if (normalizedIds.some((id) => !/^\d+$/.test(id))) {
        return res.status(400).json({ error: "listingIds must contain only numeric BuyMesho listing IDs" });
      }
      if (new Set(normalizedIds).size !== normalizedIds.length) {
        return res.status(400).json({ error: "listingIds must be unique" });
      }

      const comparison = await compareBuyMeshoListings(db, normalizedIds);
      return res.json({ comparison });
    } catch (error) {
      console.error("BuyMesho listing comparison error:", error);
      const message = error instanceof Error ? error.message : "BuyMesho listing comparison is currently unavailable";
      return res.status(503).json({ error: message, code: "COMPARISON_UNAVAILABLE" });
    }
  });

  app.post("/api/ai/moderate", requireFirebaseUser, authenticatedAiRateLimit, async (req, res) => {
    try {
      const { text, type = "listing" } = req.body || {};
      if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT_LENGTH) {
        return res.status(400).json({ error: "text is required and must be 8,000 characters or fewer" });
      }
      if (type !== "listing" && type !== "message") {
        return res.status(400).json({ error: "type must be listing or message" });
      }

      const moderation = await moderateContent({ text, type });
      return res.json({ moderation });
    } catch (error) {
      console.error("AI Moderation error:", error);
      const message = error instanceof Error ? error.message : "AI moderation is currently unavailable";
      return res.status(503).json({ error: message, code: "AI_UNAVAILABLE" });
    }
  });
}
