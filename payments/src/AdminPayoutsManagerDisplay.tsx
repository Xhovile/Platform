import { useEffect } from "react";
import AdminPayoutsManager from "./AdminPayoutsManager";

const HIDDEN_SUMMARY_LABELS = new Set([
  "provider charge",
  "last attempt",
  "audit snapshot",
]);

type Tone = {
  background: string;
  border: string;
  accent: string;
};

function getToneFromCardText(text: string): Tone {
  const normalized = text.toLowerCase();

  if (normalized.includes("paid")) {
    return {
      background: "rgba(16, 185, 129, 0.08)",
      border: "rgba(16, 185, 129, 0.22)",
      accent: "#10b981",
    };
  }

  if (normalized.includes("failed")) {
    return {
      background: "rgba(244, 63, 94, 0.08)",
      border: "rgba(244, 63, 94, 0.22)",
      accent: "#f43f5e",
    };
  }

  if (normalized.includes("destination pending verification") || normalized.includes("destination missing")) {
    return {
      background: "rgba(249, 115, 22, 0.08)",
      border: "rgba(249, 115, 22, 0.22)",
      accent: "#f97316",
    };
  }

  if (normalized.includes("held")) {
    return {
      background: "rgba(113, 113, 122, 0.08)",
      border: "rgba(113, 113, 122, 0.22)",
      accent: "#71717a",
    };
  }

  if (normalized.includes("eligible for payout") || normalized.includes("retry eligible")) {
    return {
      background: "rgba(250, 204, 21, 0.08)",
      border: "rgba(250, 204, 21, 0.24)",
      accent: "#eab308",
    };
  }

  return {
    background: "rgba(255, 255, 255, 0.9)",
    border: "rgba(228, 228, 231, 1)",
    accent: "#a1a1aa",
  };
}

function hideTechnicalRowSummaries(root: ParentNode = document): void {
  const candidates = Array.from(root.querySelectorAll("p"));

  for (const candidate of candidates) {
    const label = candidate.textContent?.trim().toLowerCase();
    if (!label || !HIDDEN_SUMMARY_LABELS.has(label)) continue;

    if (candidate.closest("aside")) {
      continue;
    }

    const card = candidate.parentElement;
    if (card instanceof HTMLElement) {
      card.style.display = "none";
    }
  }
}

function colorPayoutCards(root: ParentNode = document): void {
  const detailButtons = Array.from(root.querySelectorAll("button")).filter(
    (button) => button.textContent?.trim() === "Details"
  );

  for (const button of detailButtons) {
    const controls = button.closest("div");
    const card = controls?.parentElement?.parentElement;

    if (!(card instanceof HTMLElement)) continue;
    if (card.closest("aside")) continue;

    const tone = getToneFromCardText(card.textContent ?? "");
    card.style.background = `linear-gradient(180deg, ${tone.background}, rgba(255,255,255,0.96))`;
    card.style.borderColor = tone.border;
    card.style.boxShadow = "0 10px 24px rgba(0, 0, 0, 0.04)";
    card.style.borderLeft = `6px solid ${tone.accent}`;
  }
}

export default function AdminPayoutsManagerDisplay() {
  useEffect(() => {
    let rafId = 0;

    const apply = () => {
      hideTechnicalRowSummaries(document);
      colorPayoutCards(document);
    };

    apply();
    rafId = window.requestAnimationFrame(apply);

    const observer = new MutationObserver(() => {
      hideTechnicalRowSummaries(document);
      colorPayoutCards(document);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      observer.disconnect();
    };
  }, []);

  return <AdminPayoutsManager />;
}
