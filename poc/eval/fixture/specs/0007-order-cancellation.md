# 0007: Order cancellation

## Problem

Customers cannot cancel an order after creating it. Support cancels orders by hand in the database.

## Goals

- `POST /orders/{id}/cancel` cancels an order that is not shipped yet.
- A cancelled order shows `status: cancelled` in `GET /orders/{id}`.
- Cancelling a shipped order returns 409 with a clear message; an unknown order returns 404.
- Cancelling twice is idempotent (second call returns 200 with the same body).
- The CLI `orders-admin cancel <id>` calls the same endpoint and prints the new status.

## Design

Add a `status` field (`created`, `shipped`, `cancelled`) to the order record. The cancel endpoint checks the status and
updates it. The admin CLI is a thin wrapper over the HTTP API. Docs: `docs/orders.md` gains a "Cancelling an order"
section.

## Acceptance contract

TODO
