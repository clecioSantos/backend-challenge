# Architecture

Reference implementation of the distributed wagering processor. This document
explains the decisions behind the code, not the challenge itself. Read it
alongside `README.md` (the assignment) and the source tree.

## 1. Goals and invariants

The system must stay correct while messages are duplicated, delivered out of
order or processed concurrently. Concretely, the four global invariants are:

1. no duplicated credit or debit;
2. no lost confirmed event;
3. no negative balance;
4. `wallet.balance` always equals the balance rebuilt from the ledger.

Every design decision below is justified by one of these.

## 2. Layering

```
http            NestJS controllers, DTOs, guards, filters  (transport only)
application     use cases, ports, canonical JSON hashing
domain          Money, Wallet, WagerTransaction, ledger, inbox, outbox, events
infrastructure  MikroORM, SQS, workers, metrics, logging, clock
```

Dependencies point inwards. The domain imports nothing from NestJS, MikroORM or
AWS; persistence and messaging enter through ports defined in `application`.
The exception filter and controllers are the only places that know about HTTP,
and adapters are the only places that know about the ORM or the broker.

Notable boundaries:

- `Money` is a value object backed by `decimal.js`, never a `number`;
- repositories are defined as interfaces in the domain and implemented under
  `infrastructure/persistence/repositories`;
- `UnitOfWork` (port) yields a `TransactionContext` with all repositories bound
  to the same SQL transaction.

## 3. Money

- Stored and transported as a decimal **string** with fixed scale 2; the
  `numeric(20,2)` column keeps the DB representation exact.
- Input is validated by a strict regex: no sign, no exponent, at most 2 decimal
  places, max 18 integer digits — the same bound as the column.
- `Money` is immutable; arithmetic returns new instances. Intermediate results
  may be negative so callers can compare against zero, but values entering the
  system (transactions, credits, debits) must be strictly positive.
- Every binary operation asserts the currencies match.
- `toJSON()` is what crosses the wire, so the ORM's money types never leak into
  the domain.

## 4. Wallet and ledger

The wallet is the aggregate root and the **unit of concurrency**.

- `version` starts at 1 and increments only when the balance changes.
- `debit`/`credit` return the ledger entry they produced, so a balance change
  and its audit row are created together and can never drift.
- The ledger row is structurally immutable (no setters, no transitions) and the
  schema enforces it with a `before update or delete` trigger.

The database enforces what the code promises:

| Guarantee | Where |
|---|---|
| one wallet per `(playerId, currency)` | unique index `wallets_player_currency_uq` |
| non-negative balance | check `wallets_balance_non_negative` |
| one ledger entry per `(transaction, wallet)` | unique index `wallet_ledger_entries_transaction_wallet_uq` |
| non-negative ledger arithmetic | checks on `balance_before`/`balance_after` |
| ledger append-only | trigger `wallet_ledger_entries_no_mutation` |
| unique idempotency key and provider transaction | unique indexes on `wager_transactions` |

## 5. Concurrency

The chosen strategy is **pessimistic row locking on the wallet**, combined with
optimistic version checking and database unique constraints as defence in depth.

- The ingress path always takes `SELECT ... FOR UPDATE` on the wallet
  (`findByIdForUpdate`) *before* reading the idempotency key. Two requests that
  touch the same wallet are therefore serialised; different wallets proceed in
  parallel.
- `save(wallet, expectedVersion)` also compares versions, so a programming path
  that forgets the lock still fails loudly instead of producing a lost update.
- Lock ordering is fixed: **wallet first, then transaction**. The pending
  reference worker respects the same order, which avoids deadlocks between
  concurrent resume and ingress of the same wallet.
- There is no global lock: the resource is the `walletId`, so hot wallets
  serialise and cold wallets scale horizontally.

This is validated by the mandatory scenario (two `80.00` bets over `100.00`:
one `PROCESSED`, one `REJECTED`, balance `20.00`, a single debit) and by three
concurrent application instances competing for one wallet.

## 6. Idempotency

- The `Idempotency-Key` header is the source of truth; default is
  `"{providerId}:{externalTransactionId}"`.
- `payloadHash` is the SHA-256 of a **canonical JSON** serialization (object keys
  sorted, `undefined` dropped) of the business fields only. Transport metadata
  and headers are excluded. See `application/crypto/canonical-json.ts`.
- A request with a known key and the same hash replays the original result,
  including the balance observed at the time. A known key with a different hash
  is an `IDEMPOTENCY_CONFLICT`, never a replay.
- Deduplication does **not** rely on an in-memory cache: it is the unique index
  on `idempotency_key` plus the persistent inbox.

## 7. References and out-of-order delivery

- `REFUND`/`ROLLBACK` require `referenceExternalTransactionId`. The reference is
  resolved by `(providerId, referenceExternalTransactionId)` and must match
  provider, player, wallet, currency and round; the amount must be equal.
- A reversal that arrives before its reference is stored as
  `PENDING_REFERENCE` with an exponential backoff schedule
  (`next_reference_attempt_at`) and a bounded attempt counter.
- A scheduled worker re-drives due rows through the *same* use case. Past the
  attempt limit the transaction is rejected with `REFERENCE_NOT_FOUND` and an
  event is emitted. Attempt limit is 8 with a 2s base / 5min cap
  (`PENDING_REFERENCE_*` env vars).
- A reference can only be reversed once per reversal kind
  (`REFERENCE_ALREADY_REVERSED`).
- A reversal that would drive the balance negative is rejected with
  `REVERSAL_WOULD_GO_NEGATIVE`, deliberately distinct from
  `INSUFFICIENT_FUNDS`.

## 8. Inbox / outbox

The change of a wallet, its ledger entry, the inbox claim (for queue input), the
transaction row and the outbox events are written in **one SQL transaction**
through `UnitOfWork.run`.

- **Inbox**: `ON CONFLICT DO NOTHING` on `(consumerName, messageId)` claims the
  message; `processed_at` is set just before commit. If the transaction rolls
  back, the claim rolls back too, so redelivery is safe. A duplicate that finds
  the message already processed replays the original transaction result.
- **Outbox**: events are inserted in the same transaction. A worker claims due
  rows with `FOR UPDATE SKIP LOCKED`, publishes them, marks them published and
  commits. Holding the lock across publish guarantees no two publishers send the
  same row; a crash after commit but before publish leaves the row pending for
  the next tick. A publish that succeeds but whose commit fails is retried and
  is safe because consumers deduplicate.
- No event is ever published before the financial transaction commits.

The repository calls that must be transactional use `EntityManager.execute`
(transaction-aware) rather than `getConnection().execute`, so the inbox claim is
part of the same transaction.

## 9. Messaging (SQS)

- Queues are FIFO (`wager-transactions.fifo`, `wager-transactions-dlq.fifo`) for
  optimistic ordering and per-aggregate grouping (`aggregateId` = message group
  id, event id = deduplication id). FIFO is treated as an optimization only —
  correctness rests on the database.
- The consumer reuses the exact same use case as HTTP. It acks (`DeleteMessage`)
  only after commit.
- Failure classification:
  - business/validation errors and unknown state → terminal → DLQ;
  - `InfrastructureError` marked non-retryable → DLQ;
  - transient failures → `ChangeMessageVisibility` with exponential backoff,
    gated by `SQS_MAX_RECEIVE_COUNT`; the broker redrive policy is the last
    resort;
  - malformed payloads → DLQ immediately.
- On `SIGTERM` the loop stops scheduling new polls and finishes the in-flight
  batch; anything not acked becomes visible again and is redelivered.

## 10. Failure taxonomy

`FailureCode` is stable and machine-readable, grouped by the action a provider
should take (`FailureDisposition`: `resend`, `fix_payload`, `give_up`). The
disposition mapping is in `domain/shared/failure-code.ts`, so a provider never
has to parse human messages.

## 11. HTTP status mapping

| Situation | Status |
|---|---|
| invalid body/query | 400 |
| idempotency conflict, wallet already exists | 409 |
| business rejection (no funds, bad reference, ...) | 422 |
| accepted, pending reference | 202 |
| not found | 404 |
| optimistic lock / transient infrastructure | 503 |
| unexpected | 500 |

All mappings live in `http/filters/all-exceptions.filter.ts`.

## 12. Authentication

Authentication does not score and is intentionally not implemented as a local
user store. The extension point is `ProviderIdentityPort`: the default
`AnonymousProviderIdentityAdapter` returns anonymous and the
`ProviderIdentityGuard` attaches an identity when one is resolved. Swapping the
adapter for an OIDC/JWKS implementation (Keycloak, Zitadel, ...) is the only
change required; health endpoints are open and do not use the guard. Messages
from the queue are a trusted internal channel, but the provider identity they
carry is still subject to all domain validations.

## 13. Observability

- Structured JSON logs via `nestjs-pino`, with request correlation ids and
  redaction of authorization headers and financial payloads.
- Prometheus metrics (`GET /metrics`): transactions by status, duplicates,
  retries, lock conflicts, DLQ messages, processing latency histogram, outbox
  pending and outbox lag gauges.
- `GET /health/live` (process) and `GET /health/ready` (PostgreSQL + SQS).

## 14. Testing

- **Unit** (no containers): `Money` (scale, rounding, invalid inputs), `Wallet`
  invariants, ledger balance check, transaction state machine and kind rules.
- **Integration** (real PostgreSQL + real LocalStack): migrations/constraints,
  the full wager lifecycle, references, inbox redelivery and concurrency,
  atomicity of the unit of work, outbox partitioning between concurrent
  publishers, and the SQS consumer end to end (including DLQ routing).
- **Concurrency** (real parallel transactions): the section 8 scenario, the same
  bet delivered 50 times in parallel, distinct wallets in parallel and three
  competing application instances. Every test asserts the final reconciliation
  invariant.

Run `bun run test` with the infrastructure up. The suite requires real
PostgreSQL and LocalStack; it never substitutes them with mocks.

## 15. Load experiment

`bun run test:load` drives the real processed path with a worker pool and prints
environment, throughput, p50/p95/p99, error rate, lock conflicts, outbox lag and
a final reconciliation. It is deliberately honest: results depend on the host
and Docker resource limits, and the numbers above are not a target. Parameters
are configurable through `LOAD_WALLETS`, `LOAD_OPERATIONS`, `LOAD_CONCURRENCY`
and `LOAD_AMOUNT`.

## 16. Trade-offs and limitations

- **Pessimistic locking** bounds throughput of a single hot wallet (serialised by
  design) in exchange for simplicity and strong correctness. A sharded or
  queue-per-wallet design was out of scope.
- **FIFO is not load-bearing.** The system is correct even under standard queues
  and out-of-order delivery; ordering is only an optimization.
- **The outbox publisher holds a row lock while calling SQS.** This makes
  "exactly one publisher per row" trivial but couples lock hold time to broker
  latency. If that ever hurts, the alternative is a two-phase claim
  (`lockedUntil` column) at the cost of more states.
- **Reference resolution is by provider external id**, which is what the
  provider knows; an internal id would be faster but would not survive the
  at-least-once, out-of-order contract.
- **No event sourcing.** The ledger is append-only but the wallet is a
  materialized read model with a reconciler, which is simpler to operate.
- The in-process polling workers are single-threaded; horizontal scaling is done
  by running several instances (the SKIP LOCKED design supports it).
