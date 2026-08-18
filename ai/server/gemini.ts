import { GoogleGenAI } from "@google/genai";

export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
const DEFAULT_GEMINI_FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];

export class GeminiServiceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "GeminiServiceError";
    if (options && "cause" in options) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        enumerable: false,
        value: options.cause,
      });
    }
  }
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiServiceError("GEMINI_API_KEY is not configured");
  }
  return new GoogleGenAI({ apiKey });
}

function parseConfiguredFallbackModels(): string[] {
  const raw = process.env.GEMINI_FALLBACK_MODELS?.trim();
  if (!raw) return DEFAULT_GEMINI_FALLBACK_MODELS;

  return raw
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
}

export function getGeminiModelCandidates(): string[] {
  return Array.from(
    new Set(
      [
        process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
        ...parseConfiguredFallbackModels(),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (!trimmed.startsWith("```")) return trimmed;

  const firstLineBreak = trimmed.indexOf("\n");
  const withoutFence = firstLineBreak >= 0 ? trimmed.slice(firstLineBreak + 1) : trimmed;
  return withoutFence.replace(/```\s*$/g, "").trim();
}

export function parseGeminiJson<T>(text: string): T {
  const cleaned = stripJsonFence(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start < 0 || end <= start) {
    throw new GeminiServiceError("Gemini returned invalid structured JSON");
  }

  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch (error) {
    throw new GeminiServiceError("Gemini returned malformed structured JSON", { cause: error });
  }
}

export async function generateGeminiJson<T>(params: {
  systemInstruction: string;
  payload: unknown;
}): Promise<T> {
  const ai = getGeminiClient();
  let lastError: unknown;

  for (const model of getGeminiModelCandidates()) {
    try {
      const response = await ai.models.generateContent({
        model,
        config: {
          systemInstruction: params.systemInstruction,
          responseMimeType: "application/json",
        },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify(params.payload) }],
          },
        ],
      });

      const text = response.text?.trim();
      if (!text) {
        throw new GeminiServiceError("Gemini returned an empty response");
      }

      return parseGeminiJson<T>(text);
    } catch (error) {
      lastError = error;
      console.warn(
        `[BuyMesho Gemini] Model "${model}" failed; trying next candidate`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  throw new GeminiServiceError("All configured Gemini models failed", { cause: lastError });
}
