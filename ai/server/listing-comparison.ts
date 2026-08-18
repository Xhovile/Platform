import { generateGeminiJson } from "./gemini.js";

export type ListingComparisonItem = {
  id: string;
  name: string;
  category?: string;
  price: number;
  description?: string;
  condition?: string;
  university?: string;
  location?: string;
  specs?: Record<string, unknown>;
};

export type ListingComparisonResult = {
  summary: string;
  winner_id: string;
  winner_reason: string;
  item_evaluations: Array<{ id: string; value_score: number; pros: string[]; cons: string[]; best_for: string }>;
};

function parseSpecs(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function loadCanonicalListings(db: any, listingIds: string[]): ListingComparisonItem[] {
  if (!db) throw new Error("Marketplace database is unavailable");
  const placeholders = listingIds.map(() => "?").join(", ");
  const rows = db.prepare(`SELECT l.id, l.name, l.category, l.price, l.description, l.condition, l.university, l.location, l.spec_values FROM listings l WHERE l.id IN (${placeholders}) AND l.is_hidden = 0 AND l.deleted_at IS NULL`).all(...listingIds) as Array<Record<string, unknown>>;
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const missing = listingIds.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`One or more BuyMesho listings could not be found: ${missing.join(", ")}`);
  return listingIds.map((id) => {
    const row = byId.get(id)!;
    return {
      id,
      name: String(row.name ?? "").slice(0, 200),
      category: typeof row.category === "string" ? row.category.slice(0, 100) : undefined,
      price: Number(row.price ?? 0),
      description: typeof row.description === "string" ? row.description.slice(0, 1200) : undefined,
      condition: typeof row.condition === "string" ? row.condition.slice(0, 100) : undefined,
      university: typeof row.university === "string" ? row.university.slice(0, 150) : undefined,
      location: typeof row.location === "string" ? row.location.slice(0, 150) : undefined,
      specs: parseSpecs(row.spec_values),
    };
  });
}

const SYSTEM_INSTRUCTION = `You are BuyMesho's product comparison engine.
Compare ONLY the canonical BuyMesho marketplace listings supplied in the request. Do not use outside market data, remembered products, assumed specifications, delivery options, or invented seller information.
Your comparison is decision support, not an authoritative valuation or factual product certification.
RULES:
- Every factual statement must be supported by supplied canonical listing data.
- Do not invent missing specifications, warranties, stock, delivery, location, ratings, seller reputation, authenticity, or availability.
- Price is the canonical BuyMesho listing price only.
- Condition is unknown when it is not supplied.
- Value score is relative decision support, not a market valuation.
- Select winner_id from supplied IDs only.
- Return one evaluation for every supplied item.
- Return valid JSON only.`;

export async function compareBuyMeshoListings(db: any, listingIds: string[]): Promise<ListingComparisonResult> {
  if (listingIds.length < 2 || listingIds.length > 3) throw new Error("Between 2 and 3 listings are required for comparison");
  const ids = listingIds.map(String);
  if (new Set(ids).size !== ids.length) throw new Error("Listing IDs must be unique");
  const canonicalItems = loadCanonicalListings(db, ids);
  const result = await generateGeminiJson<ListingComparisonResult>({ systemInstruction: SYSTEM_INSTRUCTION, payload: { items: canonicalItems } });
  const allowedIds = new Set(ids);
  if (!allowedIds.has(String(result.winner_id))) throw new Error("Comparison returned an invalid winner_id");
  if (!Array.isArray(result.item_evaluations) || result.item_evaluations.length !== canonicalItems.length) throw new Error("Comparison returned an incomplete item evaluation set");
  const evaluations = result.item_evaluations.map((evaluation) => {
    const id = String(evaluation.id);
    if (!allowedIds.has(id)) throw new Error("Comparison returned an invalid item ID");
    const score = Number(evaluation.value_score);
    if (!Number.isFinite(score) || score < 1 || score > 10) throw new Error("Comparison returned an invalid value score");
    return {
      id,
      value_score: score,
      pros: Array.isArray(evaluation.pros) ? evaluation.pros.filter((value) => typeof value === "string").slice(0, 6) : [],
      cons: Array.isArray(evaluation.cons) ? evaluation.cons.filter((value) => typeof value === "string").slice(0, 6) : [],
      best_for: typeof evaluation.best_for === "string" ? evaluation.best_for.slice(0, 300) : "Based on the supplied listing information",
    };
  });
  if (new Set(evaluations.map((evaluation) => evaluation.id)).size !== canonicalItems.length) throw new Error("Comparison returned duplicate or missing item evaluations");
  return {
    summary: typeof result.summary === "string" && result.summary.trim() ? result.summary.trim().slice(0, 1200) : "Comparison completed from the canonical BuyMesho listing information.",
    winner_id: String(result.winner_id),
    winner_reason: typeof result.winner_reason === "string" && result.winner_reason.trim() ? result.winner_reason.trim().slice(0, 800) : "Selected from the canonical BuyMesho listing information.",
    item_evaluations: evaluations,
  };
}
