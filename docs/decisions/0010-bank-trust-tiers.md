# ADR-0010: Rank evidence by confidence, and gate auto-settlement

* Status: Accepted
* Date: 2026-08-12

## Context

The initial security model was "prove the email really came from the bank" —
pin the sender, assert DKIM alignment, enforce a unique UTR. Necessary, and not
sufficient.

Moneylife documented (1 July 2026) RBL Bank sending DKIM-valid
"Account Credited" e-alerts where **47 of 54 corresponded to no credit in the
statement**; RBL confirmed they fire on declined transactions and internal
reversals.

So authentication proves *the bank sent it*. It does not prove *the bank was
right*. Separately, a bank **statement** is the account's own ledger and cannot
lie in this way — it is slower but strictly stronger than an alert.

## Decision

Evidence carries a `confidence`, ranked:

| Tier | Source | Auto-settles? |
|---|---|---|
| `ledger` | statement row, or a bank callback | Always |
| `alert` | bank credit-alert email | Only from a `verified` bank, below a value ceiling |
| `asserted` | a human with account access confirmed | Always |
| `claimed` | the customer says they paid | Never alone |

Banks additionally carry a trust tier in `parsers.json` — `verified`,
`unverified`, `unsuitable`, `unreliable`. RBL is `unreliable` and never
auto-settles at any amount. The default auto-settle ceiling is ₹3,000, so a
false positive costs one item rather than a bulk order.

## Consequences

A shop can run automatically on a bank we trust, and degrades to human review on
one we do not — rather than being either unsafe or unusable.

Only HDFC is `verified` today, from a primary source. That is a small supported
list, and honesty about it is the point: a wrong `verified` ships goods for free.

Statement upload is reframed. It is not a degraded fallback for shops without
email alerts; it is the *authoritative* channel, merely slower.
