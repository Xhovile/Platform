export type ArchitectureSource = {
  area: string;
  sourceFiles: string[];
  verifiedFacts: string[];
};

/**
 * Verified implementation snapshot used by user-facing BuyMesho AI services.
 * This is not a roadmap, proposal, assumption, or generic marketplace model.
 */
export const BUYMESHO_ARCHITECTURE_VERSION = "2026-08-11";

export const BUYMESHO_ARCHITECTURE: ArchitectureSource[] = [
  {
    area: "Application shell and navigation",
    sourceFiles: ["src/main.tsx", "src/RootRouter.tsx", "src/lib/appNavigation.ts"],
    verifiedFacts: [
      "BuyMesho is a client application mounted through src/main.tsx and routed through the RootRouter/app navigation layer.",
      "The application has dedicated public and authenticated experiences rather than a single undifferentiated page.",
      "Navigation includes marketplace, account, messaging, seller, events/tickets, payments/orders and admin areas present in the implementation.",
      "The current UI hides the global Copilot launcher on Profile, Become Seller, Create/List Item, My Listings, Messages, Saved, Hidden, Payments, Seller Payouts and Admin pages, while keeping it visible on Settings and other eligible pages.",
    ],
  },
  {
    area: "Authentication and account",
    sourceFiles: [
      "src/LoginPage.tsx",
      "src/SignupPage.tsx",
      "src/ForgotPasswordPage.tsx",
      "src/VerifyEmailPage.tsx",
      "src/ChangeEmailPage.tsx",
      "src/components/AuthSessionCheckpoint.tsx",
      "src/SettingsPage.tsx",
      "src/ProfilePage.tsx",
    ],
    verifiedFacts: [
      "BuyMesho implements login and signup flows.",
      "Password recovery and email verification are implemented.",
      "Account settings and profile management are implemented.",
      "Authentication-sensitive flows use an authenticated session/checkpoint layer.",
    ],
  },
  {
    area: "Marketplace and listings",
    sourceFiles: [
      "src/HomePage.tsx",
      "src/CategoryPage.tsx",
      "src/CreateListingPage.tsx",
      "src/EditListingPage.tsx",
      "src/MyListingsPage.tsx",
      "src/listingDetails/*",
      "server/routes/listings.routes.ts",
      "server/routes/marketplace.routes.ts",
    ],
    verifiedFacts: [
      "BuyMesho has marketplace discovery/home and category browsing experiences.",
      "Listing creation, listing editing and seller-owned listing management are implemented.",
      "Listing detail views are implemented.",
      "Marketplace listing APIs exist on the server.",
    ],
  },
  {
    area: "Seller ecosystem",
    sourceFiles: [
      "src/SellerProfilePage.tsx",
      "src/SellerDashboardPage.tsx",
      "src/SellersDirectoryPage.tsx",
      "src/pages/seller-payouts/SellerPayoutsPage.tsx",
      "src/BecomeSellerPage.tsx",
    ],
    verifiedFacts: [
      "BuyMesho has seller profiles and a seller directory.",
      "BuyMesho has a seller dashboard.",
      "BuyMesho has a dedicated seller payouts/settings area.",
      "BuyMesho implements a Become Seller flow.",
    ],
  },
  {
    area: "Messaging",
    sourceFiles: [
      "src/lib/messages.ts",
      "src/MessageThreadPage.tsx",
      "server/routes/messagesRoutes.ts",
      "server/modules/messages/*",
    ],
    verifiedFacts: [
      "BuyMesho has a messages inbox/thread experience.",
      "Messaging supports listing-specific conversations.",
      "Messaging also supports direct seller conversations and event-specific conversations in the current implementation.",
      "Seller/event conversation context may exist without a listing attachment.",
    ],
  },
  {
    area: "Events and tickets",
    sourceFiles: [
      "src/EventsDirectoryPage.tsx",
      "src/EventsCreatePage.tsx",
      "src/TicketsPage.tsx",
      "src/EventTicketTrackingPage.tsx",
      "src/eventSchemas/*",
      "server/routes/events.routes.ts",
      "server/modules/admin/admin.events.routes.ts",
    ],
    verifiedFacts: [
      "BuyMesho has an events directory.",
      "BuyMesho has event creation functionality.",
      "BuyMesho has a buyer tickets area.",
      "BuyMesho has event ticket tracking functionality.",
      "Event data has dedicated schemas and server routes.",
    ],
  },
  {
    area: "Cart, checkout, orders and tracking",
    sourceFiles: [
      "src/CartPage.tsx",
      "src/lib/orderApi.ts",
      "src/lib/orderFlow.ts",
      "src/OrderTrackingPage.tsx",
      "src/TrackOrderPage.tsx",
      "src/modules/orders/orderState.ts",
    ],
    verifiedFacts: [
      "BuyMesho has a cart experience.",
      "BuyMesho has order APIs and order-flow logic.",
      "BuyMesho has order tracking pages.",
      "Order state is represented explicitly in the application.",
    ],
  },
  {
    area: "Payments, escrow and disputes",
    sourceFiles: [
      "src/BuyerPaymentsPage.tsx",
      "src/PaymentsHubPage.tsx",
      "src/DisputesPage.tsx",
      "src/shared/types/payment.ts",
      "src/lib/paymentsOverview.ts",
      "server/modules/payments/payment.routes.ts",
      "server/modules/escrow/*",
      "server/modules/payouts/*",
    ],
    verifiedFacts: [
      "BuyMesho has buyer payment and payments-hub experiences.",
      "Payment, escrow and payout modules exist on the server.",
      "BuyMesho has a disputes experience.",
      "Do not claim a specific payment provider, payment method, escrow state transition or payout rule unless it is present in the relevant implementation being inspected.",
    ],
  },
  {
    area: "Admin",
    sourceFiles: [
      "src/AdminHubPage.tsx",
      "src/AdminPaymentsPage.tsx",
      "src/AdminPaymentsConsole.tsx",
      "server/modules/admin/*",
    ],
    verifiedFacts: [
      "BuyMesho has an admin area.",
      "Admin payment functionality exists.",
      "Administrative server routes/modules exist.",
    ],
  },
  {
    area: "Reviews and seller reputation",
    sourceFiles: [
      "server/routes/reviewsRoutes.ts",
      "src/components/reviews/ListingReviewFeed.tsx",
      "src/components/reviews/ReviewReplyComposer.tsx",
    ],
    verifiedFacts: [
      "BuyMesho has listing review display functionality.",
      "BuyMesho has review reply functionality.",
      "Reviews are implemented through dedicated server routes.",
    ],
  },
  {
    area: "AI features currently implemented",
    sourceFiles: [
      "server/routes/ai.routes.ts",
      "server/lib/listing-ai-studio.ts",
      "server/lib/ai.ts",
      "server/lib/buymesho-copilot.ts",
      "src/lib/ai.ts",
      "src/components/ai/ListingAiStudio.tsx",
      "src/components/ai/BuyMeshoCopilotDrawer.tsx",
      "src/components/ai/ProductCompareModal.tsx",
    ],
    verifiedFacts: [
      "AI Listing Studio exists for listing enhancement, pricing suggestions and moderation.",
      "BuyMesho Copilot exists as an in-product assistant drawer.",
      "A product comparison capability exists in the current application code.",
      "AI server routes call server-side AI services; the Copilot must not invent product/platform behavior beyond this registry and the supplied live listing context.",
    ],
  },
];

export function architectureAsPromptContext(): string {
  return JSON.stringify(
    {
      architecture_version: BUYMESHO_ARCHITECTURE_VERSION,
      authority: "IMPLEMENTED_BUYMESHO_CODE_SNAPSHOT",
      rule: "This registry contains verified implementation facts. It is not a roadmap, proposal, design suggestion, or assumption.",
      areas: BUYMESHO_ARCHITECTURE,
    },
    null,
    2,
  );
}
