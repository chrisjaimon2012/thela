# Which banks does automatic payment verification work with?

Short answer: **HDFC, confidently. A few others, probably. Several, not at all.**

If you are choosing where to open the account for your shop, choose HDFC.

## Why this is not uniform

India mandates SMS transaction alerts. It does not mandate email ones.

> "The SMS alerts shall mandatorily be sent to the customers, while email alerts
> may be sent, wherever registered."
> — RBI/2017-18/15, 6 July 2017, para 5

Every bank therefore does something different, and several apply a minimum
amount below which no alert fires at all. A ₹5,000 threshold — which two large
banks apply — makes a shop with a ₹1,200 average order completely invisible.

## The tiers

| Tier | Meaning | Auto-confirms? |
|---|---|---|
| `verified` | UPI credit emails confirmed from a primary source, no minimum threshold | Yes, up to the value ceiling |
| `unverified` | Email exists, UPI-credit behaviour unconfirmed | Only after a passing self-test *and* one manual confirmation |
| `unsuitable` | No email on UPI credit, or a threshold above normal order values | No — use manual mode or a gateway |
| `unreliable` | Sends credit emails that don't reliably correspond to money | **Never, at any amount** |

## The banks

**HDFC Bank — `verified`, recommended.** When HDFC imposed SMS thresholds in
June 2024, it explicitly continued email for *all* UPI transactions, and users
report alerts arriving for ₹10 payments. Email alerts are free. The body is
plain text carrying the amount to two decimals, the counterparty VPA, and the
12-digit UPI reference.

Two quirks the software handles for you: HDFC runs **two sender domains
concurrently** (`hdfcbank.net` and `hdfcbank.bank.in`, following the industry
migration to RBI-designated `bank.in` domains), so matching is on the DKIM `d=`
value rather than the `From` header. And HDFC has **no alerts-only email
address** — changing it changes your primary email for every HDFC relationship
— so the Email Worker forwards a copy to your real inbox.

**ICICI — `unsuitable`.** Its own alerts page scopes email to NRI customers.
Residents get SMS, with a credit threshold defaulting to ₹5,000.

**SBI — `unsuitable`.** The product is "SMS Alert", with a ₹5,000 minimum on
credits, and users report no alert at all on inward UPI unless the payer used
an `@sbi`/`@oksbi` handle.

**IndusInd — `unsuitable`.** Email is offered for daily and monthly
e-statements, not per-transaction alerts.

**RBL Bank — `unreliable`. Read this one.** RBL does send DKIM-signed "Account
Credited" e-alerts. Moneylife documented a case (1 July 2026) in which **47 of
54 such emails corresponded to no credit in the statement** — RBL confirmed they
fire for declined transactions and internal reversals.

This is the single most important fact in this document, and it is why trust
tiers exist. Verifying DKIM proves *the bank sent the email*. It does not prove
*the bank was right*. A shop auto-dispatching on an RBL alert would ship goods
against payments that never landed.

**Kotak, Axis, Federal, IDFC FIRST, South Indian Bank — `unverified`.** An email
channel exists; nobody has confirmed what it does for UPI credits. Run the
self-test.

**Paytm Payments Bank — gone.** Licence cancelled effective 24 April 2026.

## If your bank isn't supported

In order of preference:

1. **Open a current account at HDFC.** You probably want a proprietorship
   current account anyway — most banks' savings terms prohibit business use.
2. **Run manual mode.** The customer submits their UTR; you check your banking
   app and press Confirm. Slower, entirely reliable, and still free.
3. **Use a gateway adapter.** Razorpay, Cashfree or Paytm PG. It costs a
   percentage and puts a company back in the middle, but it works everywhere.

## Contributing a bank

Run the self-test, redact the account number and balance, keep the amount, UTR
and narration, and open a PR adding a parser plus the redacted sample. Say
plainly whether a threshold applies — a wrong `verified` here causes a real shop
to ship goods for free.
