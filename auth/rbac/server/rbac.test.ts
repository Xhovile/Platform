import test from "node:test";
import assert from "node:assert/strict";
import { hasAdminRole, hasRole, normalizeUserRole } from "./rbac.js";

test("RBAC role model", () => {
  assert.equal(normalizeUserRole("ADMIN"), "admin");
  assert.equal(normalizeUserRole("finance_admin"), "finance_admin");
  assert.equal(normalizeUserRole("unknown"), null);

  assert.equal(hasAdminRole({ role: "admin" }), true);
  assert.equal(hasAdminRole({ role: "finance_admin" }), false);
  assert.equal(hasRole({ role: "moderator" }, "moderator"), true);
  assert.equal(hasAdminRole({ role: "finance_admin", is_admin: false }), false);
});
