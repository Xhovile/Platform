import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PayoutDestinationCard from "../PayoutDestinationCard";
import PayoutDestinationForm, { type PayoutDestinationFormValue } from "../PayoutDestinationForm";

const baseValue: PayoutDestinationFormValue = {
  destinationType: "mobile_money",
  providerName: "Airtel Money",
  providerRefId: "airtel-money",
  currency: "MWK",
  accountName: "Test Seller",
  accountNumber: "",
  mobile: "0999123456",
  isDefault: true,
};

test("PayoutDestinationForm renders mobile-money required fields without bank account fields", () => {
  const html = renderToStaticMarkup(
    <PayoutDestinationForm value={baseValue} onChange={() => undefined} onSave={() => undefined} />,
  );

  assert.match(html, /Mobile operator/);
  assert.match(html, /Mobile number/);
  assert.doesNotMatch(html, /Account number/);
  assert.match(html, /required/);
});

test("PayoutDestinationForm renders bank account fields when bank is selected", () => {
  const html = renderToStaticMarkup(
    <PayoutDestinationForm
      value={{ ...baseValue, destinationType: "bank", providerName: "NBS", accountNumber: "1234567890", mobile: "" }}
      onChange={() => undefined}
      onSave={() => undefined}
    />,
  );

  assert.match(html, /Bank/);
  assert.match(html, /Account number/);
  assert.doesNotMatch(html, /Mobile number/);
});

test("PayoutDestinationForm disables save controls while loading or disabled", () => {
  const html = renderToStaticMarkup(
    <PayoutDestinationForm value={baseValue} onChange={() => undefined} onSave={() => undefined} loading disabled />,
  );

  assert.match(html, /disabled=""/);
  assert.match(html, /Save destination/);
});

test("PayoutDestinationCard renders masked destination details only", () => {
  const rawAccountNumber = "1234567890";
  const rawMobileNumber = "0999123456";
  const html = renderToStaticMarkup(
    <PayoutDestinationCard
      destination={{
        id: "dest_1",
        sellerId: "seller_1",
        destinationType: "bank",
        providerName: "NBS",
        providerRefId: "nbs",
        currency: "MWK",
        accountName: "Test Seller",
        maskedAccount: "•••• 7890",
        isDefault: true,
        verificationStatus: "verified",
        verificationAttempts: 1,
        lastError: null,
        verifiedAt: "2026-05-18T00:00:00.000Z",
        replacedFromId: null,
        replacedById: null,
        isActive: true,
        createdAt: "2026-05-18T00:00:00.000Z",
        updatedAt: "2026-05-18T00:00:00.000Z",
      }}
    />,
  );

  assert.match(html, /•••• 7890/);
  assert.doesNotMatch(html, new RegExp(rawAccountNumber));
  assert.doesNotMatch(html, new RegExp(rawMobileNumber));
});
