import type {
  OtpDeliveryProvider,
  OtpDeliveryRequest,
  OtpDeliveryResult,
} from "../delivery.js";

const DEFAULT_GRAPH_API_VERSION = "v25.0";
const DEFAULT_GRAPH_BASE_URL = "https://graph.facebook.com";

type WhatsAppFetch = typeof globalThis.fetch;

type WhatsAppTextMessage = {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  text: {
    preview_url: false;
    body: string;
  };
};

type WhatsAppTemplateMessage = {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "template";
  template: {
    name: string;
    language: {
      code: string;
    };
    components?: unknown[];
  };
};

type WhatsAppMessagePayload = WhatsAppTextMessage | WhatsAppTemplateMessage;

type WhatsAppApiResponse = {
  messages?: Array<{ id?: string }>;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

export type WhatsAppOtpTemplateConfig = {
  name: string;
  languageCode: string;
  buildComponents?: (
    code: string,
    request: OtpDeliveryRequest,
  ) => unknown[];
};

export type WhatsAppOtpProviderOptions = {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
  baseUrl?: string;
  messageMode?: "text" | "template";
  template?: WhatsAppOtpTemplateConfig;
  buildTextMessage?: (
    code: string,
    request: OtpDeliveryRequest,
  ) => string;
  fetch?: WhatsAppFetch;
};

export class WhatsAppDeliveryError extends Error {
  readonly status: number;
  readonly metaCode?: number;
  readonly metaSubcode?: number;
  readonly traceId?: string;

  constructor(
    status: number,
    message: string,
    details?: {
      metaCode?: number;
      metaSubcode?: number;
      traceId?: string;
    },
  ) {
    super(message);
    this.name = "WhatsAppDeliveryError";
    this.status = status;
    this.metaCode = details?.metaCode;
    this.metaSubcode = details?.metaSubcode;
    this.traceId = details?.traceId;
  }
}

export class WhatsAppOtpProvider implements OtpDeliveryProvider {
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly messageMode: "text" | "template";
  private readonly template?: WhatsAppOtpTemplateConfig;
  private readonly buildTextMessage: (
    code: string,
    request: OtpDeliveryRequest,
  ) => string;
  private readonly fetchImpl: WhatsAppFetch;

  constructor(options: WhatsAppOtpProviderOptions) {
    const accessToken = options.accessToken.trim();
    const phoneNumberId = options.phoneNumberId.trim();
    const apiVersion = (options.apiVersion ?? DEFAULT_GRAPH_API_VERSION).trim();
    const baseUrl = (options.baseUrl ?? DEFAULT_GRAPH_BASE_URL).replace(/\/$/, "");
    const messageMode = options.messageMode ?? "text";

    if (!accessToken) throw new Error("WhatsApp access token is required.");
    if (!phoneNumberId) throw new Error("WhatsApp phone number ID is required.");
    if (!apiVersion) throw new Error("WhatsApp Graph API version is required.");
    if (!baseUrl) throw new Error("WhatsApp Graph API base URL is required.");

    if (messageMode === "template" && !options.template) {
      throw new Error("A WhatsApp template is required when messageMode is template.");
    }

    if (options.template) {
      if (!options.template.name.trim()) {
        throw new Error("WhatsApp template name is required.");
      }
      if (!options.template.languageCode.trim()) {
        throw new Error("WhatsApp template language code is required.");
      }
    }

    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
    this.apiVersion = apiVersion;
    this.baseUrl = baseUrl;
    this.messageMode = messageMode;
    this.template = options.template;
    this.buildTextMessage =
      options.buildTextMessage ??
      ((code) => `Your verification code is ${code}. It expires soon.`);
    this.fetchImpl = options.fetch ?? globalThis.fetch;

    if (!this.fetchImpl) {
      throw new Error("A fetch implementation is required for WhatsApp delivery.");
    }
  }

  async deliver(request: OtpDeliveryRequest): Promise<OtpDeliveryResult> {
    if (request.channel !== "whatsapp") {
      throw new Error(`WhatsApp provider cannot deliver channel: ${request.channel}.`);
    }

    const payload = this.buildPayload(request);
    const url = `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/messages`;

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = (await this.parseResponse(response)) as WhatsAppApiResponse;

    if (!response.ok) {
      const metaError = data.error;
      throw new WhatsAppDeliveryError(
        response.status,
        metaError?.message?.trim() || "WhatsApp delivery request failed.",
        {
          metaCode: metaError?.code,
          metaSubcode: metaError?.error_subcode,
          traceId: metaError?.fbtrace_id,
        },
      );
    }

    const providerMessageId = data.messages?.[0]?.id?.trim();
    if (!providerMessageId) {
      throw new WhatsAppDeliveryError(
        response.status,
        "WhatsApp delivery response did not include a message ID.",
      );
    }

    return { providerMessageId };
  }

  private buildPayload(request: OtpDeliveryRequest): WhatsAppMessagePayload {
    if (this.messageMode === "template") {
      const template = this.template!;
      return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: request.subject,
        type: "template",
        template: {
          name: template.name.trim(),
          language: {
            code: template.languageCode.trim(),
          },
          components: template.buildComponents?.(request.code, request),
        },
      };
    }

    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: request.subject,
      type: "text",
      text: {
        preview_url: false,
        body: this.buildTextMessage(request.code, request),
      },
    };
  }

  private async parseResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text.trim()) return {};

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new WhatsAppDeliveryError(
        response.status,
        "WhatsApp returned a non-JSON response.",
      );
    }
  }
}
