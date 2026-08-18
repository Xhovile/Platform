import test from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { resolveCanonicalIdentity } from "./canonicalAuth.js";

test("canonical auth boundary rejects requests without a bearer credential", async () => {
  const req = { headers: {} } as Request;
  assert.equal(await resolveCanonicalIdentity(req), null);
});
