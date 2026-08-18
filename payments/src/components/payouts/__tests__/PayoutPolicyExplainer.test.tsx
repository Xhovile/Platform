import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PayoutPolicyExplainer from "../PayoutPolicyExplainer";

test("PayoutPolicyExplainer describes automatic launch queue without manual withdrawal wording", () => {
  const html = renderToStaticMarkup(<PayoutPolicyExplainer />);

  assert.match(html, /automatic queue after escrow release/i);
  assert.match(html, /admin review/i);
  assert.match(html, /PayChangu/i);
  assert.doesNotMatch(html, /withdraw/i);
});
