# Engineering guidelines

The standards this project is held to. Written down because they were agreed in
conversation, and conversations get compacted.

These are not aspirations. Code that violates them should be changed or should
carry a comment explaining why the exception is correct.

---

## The three rules that decide most arguments

**Don't repeat yourself.** One concept, one implementation. `extract()` is
shared by the email and statement parsers because an email body and a statement
cell are both just text containing an amount and a reference — two extractors
would drift. `money.ts` owns every rupee-to-paise conversion for the same reason.

**YAGNI.** Before adding anything, ask whether it needs to exist *now*. Reserve
tables, discount engines, customer accounts and multi-carrier failover were all
considered and refused. See [NON-GOALS.md](../NON-GOALS.md), which exists so
that refusals stick.

**Reuse before rewriting.** If something in this codebase already does the job,
use it. If something in the platform does it — Cloudflare Access for admin auth,
a partial unique index for slot allocation — use that instead of writing code.

---

## Correctness

**Put invariants in the database, not in application discipline.** The schema
refuses to oversell, refuses two open orders at the same amount, refuses a
carrier order with no address, and refuses to settle one UTR twice. Application
code can be wrong; a `CHECK` constraint cannot be forgotten.

**Prefer a constraint that raises over a condition that silently passes.** This
is the single most important lesson in the codebase: in SQLite an `UPDATE`
matching zero rows *succeeds*, so a guarded conditional update inside a D1
`batch()` commits the rest of the transaction and drops the line you meant to
block. Only an error aborts a batch.

**Make illegal states unrepresentable.** A pickup order has no address because
the schema forbids one; a carrier order cannot exist without one.

**Idempotency is a design property, not a retry handler.** Every externally
triggered path — webhooks, email, statement import — must be safe to replay.

---

## Verification

**Never state a version, an API shape, a price or a regulation from memory.**
Check the registry, the vendor's own documentation, or the statute. Research
summaries are a starting point, not a source: three of four package versions
originally in `package.json` did not exist, and a cited Axis "merchant API" page
turned out to be a consumer app page.

**Prefer an executable assertion to a comment.** `tests/invariants.test.sql`
proves the seven schema invariants against real SQLite. A comment claiming the
same thing proves nothing.

**Run the thing.** Four real bugs in the first storefront commit — including a
seed file that would have written dev fixtures into a production database —
were found by running it, not by reading it.

**Distinguish what you verified from what you inferred.** If a claim rests on
inference, say so where it matters. `parsers.json` marks every bank
`unverified` for exactly this reason.

---

## Style

**Comment the why, never the what.** `// increment counter` is noise.
`// Unguarded on purpose: CHECK(...) is the mechanism that aborts the batch`
is the reason the next person does not "fix" it into a bug.

**Comment density should be proportional to surprise.** Obvious code needs
none. The two D1 idioms and the payment trust tiers carry long comments because
they look wrong and are not.

**Name things after what they are to the user.** A shopkeeper manages
*products* and *orders*, not *entities*.

**Small, well-named modules over large ones.** But not one file per function —
`money.ts` holds formatting, parsing and slot allocation because they are one
concern.

**No client-side framework unless a page genuinely needs one.** The audience is
on a mid-range Android over patchy 4G. Hydration is a cost with no return on a
product page.

---

## Dependencies

**Every dependency is a liability with a benefit.** Justify it. The production
runtime currently has one (`postal-mime`, for MIME parsing that is genuinely
hard). Razorpay's SDK was rejected in favour of ~30 lines of `fetch` and Web
Crypto, because the SDK adds axios and a compat flag to save nothing.

**Prefer platform primitives.** Native `ratelimits` bindings rather than
Durable Objects. Cloudflare Access rather than an auth library.

**Watch the bundle.** The free plan's ceiling is 3 MiB gzipped. We sit near
145 KB. If a change moves that materially, it needs a reason.

---

## Documentation

**Decisions get ADRs.** See [decisions/](decisions/). An ADR is cheap; the
alternative is re-litigating the same choice in six months with less context.

**Record refusals as carefully as choices.** NON-GOALS.md is load-bearing.

**Keep diagrams next to the thing they describe** and update them in the same
commit as the change. A stale diagram is worse than none.

---

## Security

**Authentication proves who sent something, not that it is true.** A DKIM-valid
bank email proves the bank sent it. It does not prove money arrived. Trust
tiers exist because of that distinction.

**Never trust a client-supplied amount, price, or SKU.** Recompute
server-side from the catalogue.

**Secrets are Worker secrets.** Never in `wrangler.jsonc`, never in the repo,
never in a database row.

**Assume every inbound payload is hostile**, including one that appears to come
from a bank.
