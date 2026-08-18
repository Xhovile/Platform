import { useState } from "react";
import { DollarSign, ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2, Tag } from "lucide-react";
import { generateListingDraft, suggestListingPricing, moderateContent, type ListingAiDraft, type PriceSuggestionResult, type ContentModerationResult } from "../../lib/ai";
import type { ListingDraft } from "../../types";
import { formatMoney } from "../../shared/utils/formatMoney";
import AiIcon from "./AiIcon";

type Props = {
  currentDraft: Partial<ListingDraft>;
  onApplyDraftSuggestion: (suggested: ListingAiDraft) => void;
  showFeedback: (type: "success" | "error" | "info", title: string, message: string) => void;
};

export default function ListingAiStudio({ currentDraft, onApplyDraftSuggestion, showFeedback }: Props) {
  const [loadingAction, setLoadingAction] = useState<"draft" | "pricing" | "moderation" | null>(null);
  const [pricingResult, setPricingResult] = useState<PriceSuggestionResult | null>(null);
  const [moderationResult, setModerationResult] = useState<ContentModerationResult | null>(null);

  const handleEnhanceDraft = async () => {
    if (!currentDraft.name && !currentDraft.description) {
      showFeedback("info", "Add basic notes first", "Provide at least a title or description for the Listing Studio to polish.");
      return;
    }

    setLoadingAction("draft");
    try {
      const suggested = await generateListingDraft(currentDraft);
      if (suggested && Object.keys(suggested).length > 0) {
        onApplyDraftSuggestion(suggested);
        showFeedback("success", "Listing improved", "The listing was updated using the information you provided.");
      } else {
        showFeedback("error", "Listing improvement unavailable", "No suggestions were returned. Your existing draft was left unchanged.");
      }
    } catch {
      showFeedback("error", "Listing improvement unavailable", "The operation failed. Your existing draft was left unchanged.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSuggestPrice = async () => {
    if (!currentDraft.name || !currentDraft.category) {
      showFeedback("info", "Select category & title", "Enter a title and category to get a pricing suggestion.");
      return;
    }

    setLoadingAction("pricing");
    try {
      const result = await suggestListingPricing({
        name: currentDraft.name,
        category: currentDraft.category,
        condition: currentDraft.condition,
        specs: currentDraft.spec_values,
        currentPrice: currentDraft.price ? Number(currentDraft.price) : undefined,
      });

      if (result) {
        setPricingResult(result);
        showFeedback("success", "Price suggestion ready", `AI suggested ${formatMoney(result.recommended_price)}.`);
      } else {
        setPricingResult(null);
        showFeedback("error", "Pricing unavailable", "No reliable AI price suggestion was returned. Your current price was left unchanged.");
      }
    } catch {
      setPricingResult(null);
      showFeedback("error", "Pricing unavailable", "The pricing operation failed. Your current price was left unchanged.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleAuditSafety = async () => {
    const textToAudit = `${currentDraft.name || ""} ${currentDraft.description || ""}`;
    if (!textToAudit.trim()) {
      showFeedback("info", "Empty listing", "Add title and description before running a safety review.");
      return;
    }

    setLoadingAction("moderation");
    try {
      const result = await moderateContent(textToAudit, "listing");
      if (result) {
        setModerationResult(result);
        if (result.is_safe) {
          showFeedback("success", "Safety review complete", "No obvious safety issues were detected by the AI review.");
        } else {
          showFeedback("error", "Potential safety issue", result.explanation);
        }
      } else {
        setModerationResult(null);
        showFeedback("error", "Safety review unavailable", "The AI review failed. Do not treat the listing as AI-approved.");
      }
    } catch {
      setModerationResult(null);
      showFeedback("error", "Safety review unavailable", "The AI review failed. Do not treat the listing as AI-approved.");
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="bg-linear-to-r from-emerald-900/5 via-teal-900/5 to-emerald-800/10 border border-emerald-200/80 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1 bg-white/20 rounded-lg">
            <AiIcon className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-semibold text-sm text-neutral-900">Listing AI Studio</h4>
            <p className="text-xs text-neutral-600">Improve listing content, get an AI price suggestion, and review safety signals.</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={handleEnhanceDraft}
          disabled={loadingAction !== null}
          className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-900 disabled:opacity-50 text-white font-medium text-xs rounded-xl flex items-center gap-1.5 transition-colors shadow-xs"
        >
          {loadingAction === "draft" ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <AiIcon className="w-4 h-4" />}
          Improve Listing
        </button>

        <button
          type="button"
          onClick={handleSuggestPrice}
          disabled={loadingAction !== null}
          className="px-3 py-1.5 bg-white hover:bg-emerald-50 border border-emerald-300 text-emerald-900 font-medium text-xs rounded-xl flex items-center gap-1.5 transition-colors"
        >
          {loadingAction === "pricing" ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <DollarSign className="w-3.5 h-3.5 text-emerald-700" />}
          AI Price Suggestion
        </button>

        <button
          type="button"
          onClick={handleAuditSafety}
          disabled={loadingAction !== null}
          className="px-3 py-1.5 bg-white hover:bg-neutral-100 border border-neutral-300 text-neutral-700 font-medium text-xs rounded-xl flex items-center gap-1.5 transition-colors"
        >
          {loadingAction === "moderation" ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />}
          Safety Review
        </button>
      </div>

      {pricingResult && (
        <div className="mt-3 bg-white p-3.5 rounded-xl border border-emerald-200 text-xs space-y-2 animate-in fade-in">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-neutral-800 flex items-center gap-1">
              <Tag className="w-3.5 h-3.5 text-emerald-700" /> AI Price Suggestion
            </span>
            <span className="font-bold text-emerald-800 text-sm">{formatMoney(pricingResult.recommended_price)}</span>
          </div>

          <div className="flex items-center justify-between text-neutral-600 pt-1 border-t border-neutral-100">
            <span>AI-suggested range:</span>
            <span className="font-medium text-neutral-800">{formatMoney(pricingResult.min_price)} - {formatMoney(pricingResult.max_price)}</span>
          </div>

          <p className="text-neutral-600 text-[11px] leading-relaxed pt-1">{pricingResult.market_insight}</p>
          <p className="text-[10px] text-neutral-500">
            AI decision support only · Confidence {Math.round(pricingResult.confidence_score)}% · Not a market valuation
            {pricingResult.evidence_source === "marketplace_comparables" ? ` · Based on ${pricingResult.comparable_count ?? 0} BuyMesho comparable${(pricingResult.comparable_count ?? 0) === 1 ? "" : "s"}` : null}
            {pricingResult.evidence_source === "insufficient_data" ? " · Insufficient market data" : null}
          </p>

          <button
            type="button"
            onClick={() => {
              onApplyDraftSuggestion({ price: String(pricingResult.recommended_price) });
              showFeedback("success", "Price applied", `Set price to ${formatMoney(pricingResult.recommended_price)}.`);
            }}
            className="w-full mt-1 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-900 font-semibold rounded-lg text-center transition-colors"
          >
            Apply Suggested Price
          </button>
        </div>
      )}

      {moderationResult && (
        <div
          className={`mt-3 p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
            moderationResult.is_safe ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-amber-50 border-amber-300 text-amber-900"
          }`}
        >
          {moderationResult.is_safe ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          )}
          <div>
            <p className="font-semibold">{moderationResult.is_safe ? "No obvious safety issues detected" : "Potential safety issue detected"}</p>
            <p className="text-[11px] mt-0.5">{moderationResult.explanation}</p>
            <p className="text-[10px] mt-1 text-neutral-500">AI review only; this is not a safety certification.</p>
          </div>
        </div>
      )}
    </div>
  );
}
