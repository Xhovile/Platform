# RBAC

Reusable role-based access control capability for Xhovile applications.

## Purpose

`auth/rbac/` provides authorization primitives for applications that need to evaluate roles and permissions without coupling Platform to a specific product's user model or UI.

Authentication answers **who the user is**. RBAC answers **what that authenticated identity is allowed to do**.

## Design goals

- Keep permission evaluation independent from product routes and UI.
- Accept application-owned identity and role data through explicit interfaces.
- Keep product-specific role definitions outside Platform.
- Make authorization decisions deterministic and testable.
- Avoid coupling permissions to Firebase, PostgreSQL, or another application-specific data source.

## Integration boundary

The consuming application owns:

- user/account identity
- role assignment and persistence
- product-specific roles and permissions
- resource ownership rules
- session/authentication state
- administrative role-management UI

Platform RBAC evaluates the supplied authorization context and returns an authorization decision. It does not create accounts or sessions.

## Conceptual flow

```text
Application request
      ↓
Authenticated identity
      ↓
Application authorization context
      ↓
Platform RBAC
      ↓
Permission decision
      ↓
Application route/service continues or rejects
```

## Security requirements

- Authentication must be established before relying on RBAC decisions.
- Authorization must be enforced server-side for privileged operations.
- Default behavior should be deny unless a permission is explicitly granted.
- Role names and permission identifiers should use stable, application-owned contracts.
- Resource ownership checks must not be replaced by broad role checks.
- Administrative role changes should be audited by the consuming application.

## BuyMesho extraction boundary

BuyMesho may supply the first role/permission model, but BuyMesho-specific roles, account tables, routes, and business rules must remain outside Platform RBAC.

Platform should provide the mechanism; applications define the authorization policy.

## Testing requirements

At minimum, test:

- role-to-permission evaluation
- deny-by-default behavior
- multiple roles
- missing/unknown roles
- permission inheritance, if supported
- resource ownership boundaries
- unauthenticated contexts
- administrative privilege separation
- application-specific policy adapters

## Current status

**Reusable capability — integration hardening/documentation in progress.**
