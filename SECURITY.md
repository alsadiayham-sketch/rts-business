# Security requirements

## Cashier authentication

RTS Business accepts cashier authentication only through a store's configured D1
backend (`settings/pos.dataBackend = "d1"` and `apiBaseUrl`). The application sends
the entered password only to `POST /api/pos-login`; the backend must validate it,
return a short-lived bearer token and user role, and reject invalid or disabled
accounts with 401 or 403.

Legacy Firestore `settings/pos_users` credentials are intentionally not read or
compared by the client. Stores without the server-authentication contract are blocked
until migrated; client-side password comparison is not an acceptable fallback.

## Checkout authority

Firestore checkouts use a transaction that validates available variants before creating
the order and decrementing stock. For D1 stores, `POST /api/orders` is the equivalent
server-authoritative boundary: it must authenticate the bearer token, validate stock,
and create the order and stock update in one database transaction. This repository
does not contain that backend, so a backend that cannot provide this guarantee blocks
a safe D1 checkout deployment.

## Medical files

Medical file content is uploaded to Firebase Storage and Firestore/D1 receives
metadata and the storage object path only. Deployments must enforce authenticated,
tenant-scoped Firebase Storage rules and audit access before enabling clinic uploads.
The application rejects disallowed file types and files larger than 10 MiB.

## Messaging credits and SMS

Customer messaging is available only when a D1 tenant explicitly enables
`settings/pos.messaging` with `enabled: true` and `contractVersion: 1`. There is
no Firestore or renderer-side fallback for messaging balances, customer audiences,
credit allocations, or delivery records.

The authenticated D1 API must provide these tenant-scoped endpoints:

- `GET /api/messaging/status?from=YYYY-MM-DD&to=YYYY-MM-DD` returns redacted
  balance, allocation status, pricing, aggregate analytics, and credit/message
  ledger entries. It must never return phone numbers, recipient lists, or provider
  credentials.
- `POST /api/messaging/credit-requests` creates a pending credit request and
  notifies the platform administrator.
- `POST /api/messaging/audience-preview` resolves only a selector
  (`all`, `latest`, `random`, `frequent`, or `recurrent`, with approved filters)
  into a short-lived opaque preview ID and aggregate recipient/cost totals.
- `POST /api/messaging/messages` consumes the preview ID and writes the message
  ledger/outbox entry. It must atomically revalidate authorization, audience
  eligibility, available credits, pricing, and the one-time preview before any
  provider job is queued.
- `PATCH /api/messaging/pricing` is optional and must be restricted to platform
  administrators; the renderer exposes it only when the API reports that capability.

Every mutation above must require the cashier bearer token and an `Idempotency-Key`
unique within the tenant and action. The backend must persist the key/result and
perform credit balance changes, credit ledger writes, message ledger writes, and
outbox enqueueing in one D1 transaction (or an equivalent transactional outbox).
Client-side role checks, preview totals, and disabled buttons are usability guards,
not authorization or accounting guarantees.

The redacted ledger response models are `creditLedger[]` with
`id`, `type`, `credits`, `amountNis`, `status`, `createdAt`, and `summary`, and
`messageLedger[]` with `id`, `type`, `recipientCount`, `amountNis`,
`platformCostNis`, `status`, `createdAt`, and `summary`. The platform supplies
period analytics for purchased, allocated, consumed, revenue, cost, profit,
remaining credits, and delivery rate, plus `permissions` and `capabilities` for
the signed-in role; the renderer must not infer them from contacts or provider
responses.
