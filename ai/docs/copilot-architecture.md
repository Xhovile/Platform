# BuyMesho Copilot — Verified Product Architecture

## Purpose

BuyMesho Copilot must explain the **implemented BuyMesho application**, not a proposed or remembered version of it.

This document defines the product-architecture rule used by the Copilot:

> **Implemented code is authoritative. Suggestions, plans, assumptions, generic marketplace conventions, and previous conversation ideas are not authoritative.**

The machine-readable authority is `server/lib/buymesho-architecture.ts`. The Copilot loads that registry server-side before generating answers.

## Verified application areas

The current implementation contains these verified user-facing areas:

- Application shell and navigation
- Authentication and account management
- Marketplace discovery and categories
- Listing creation, editing, management and detail views
- Seller profiles, seller directory and seller dashboard
- Seller payout area
- Buyer/seller and event messaging
- Events and event creation
- Buyer tickets and ticket tracking
- Cart, orders and order tracking
- Buyer payments, payments hub, escrow/payout server modules and disputes
- Admin area and admin payment functionality
- Listing reviews and review replies
- Listing AI Studio
- BuyMesho Copilot
- Product comparison UI/service

These are backed by source files listed in `server/lib/buymesho-architecture.ts`.

## What the Copilot may state as fact

Only information supported by the architecture registry, plus facts contained in the live marketplace data supplied to the request, may be stated as definite BuyMesho behavior.

For example:

- A verified page can be described as implemented.
- A verified workflow can be explained.
- A listing can be recommended only when that listing was supplied in the request context.

## What the Copilot must not do

The Copilot must not:

- invent routes, buttons or settings locations;
- invent payment methods or providers;
- invent seller requirements;
- invent delivery/fulfilment behavior;
- invent ratings, badges or verification guarantees;
- invent stock, prices, sellers or listings;
- turn a product roadmap or planning document into a current feature claim;
- treat generic e-commerce behavior as proof that BuyMesho supports it;
- reveal source code, credentials, internal security controls or private user data.

## Handling uncertainty

When the architecture registry does not establish an answer, the Copilot should say that the behavior is **not verified from the current BuyMesho implementation** and avoid filling the gap with an assumption.

When a capability is partly implemented or its current behavior is unclear, it should be described as unclear rather than falsely presented as complete.

## Listing-context authority

The architecture registry answers **what BuyMesho is**.

The request's `contextListings` answers **which marketplace listings are currently available to recommend**.

The Copilot must never combine those two authorities incorrectly. A real BuyMesho feature does not imply that a particular product exists, and a supplied listing does not imply that every marketplace feature supports it.

## Maintenance rule

Whenever a user-facing route, page, workflow, permission boundary, payment flow, seller flow, event/ticket flow, messaging flow or AI feature changes, update the architecture registry in the same change set.

The Copilot architecture version currently recorded by the registry is `2026-08-11`.
