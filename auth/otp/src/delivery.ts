import type { OtpChallenge } from "./contracts.js";

export type OtpDeliveryRequest = {
  challengeId: OtpChallenge["id"];
  subject: OtpChallenge["subject"];
  channel: OtpChallenge["channel"];
  code: string;
  expiresAt: OtpChallenge["expiresAt"];
};

export type OtpDeliveryResult = {
  providerMessageId?: string;
};

export interface OtpDeliveryProvider {
  deliver(request: OtpDeliveryRequest): Promise<OtpDeliveryResult>;
}
