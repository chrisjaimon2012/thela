# ADR-0022: Passkeys for the admin, because a password costs too much CPU

* Status: Accepted
* Date: 2026-08-12

## Context

The admin needed authentication, and the obvious answer was a password hashed
with PBKDF2 in D1, with Cloudflare Access as an option for anyone who wanted it.
That was written down before anyone checked what it costs.

The Workers **free plan allows 10 ms of CPU per request**. Waiting on D1 does not
count; computing a hash does. So the question is arithmetic, and it was measured
rather than assumed — a temporary route in the dev server, timed from outside
across seven runs, best-of taken, with a no-op baseline subtracted:

| Operation | CPU per call |
|---|---|
| HMAC-SHA256 sign (session cookie) | 0.003 ms |
| ECDSA P-256 verify (a passkey login) | 0.044 ms |
| PBKDF2-SHA256, 100,000 iterations | 7.5 ms |
| PBKDF2-SHA256, 210,000 iterations | 15.8 ms |
| PBKDF2-SHA256, 600,000 iterations | 45.0 ms |

600,000 is OWASP's recommendation for PBKDF2-HMAC-SHA256. It costs **4.5× the
entire free-plan budget**. Even 100,000 — well below current guidance — spends
three quarters of the budget on one login and leaves almost nothing for
rendering the page it is logging into.

These numbers are a **lower bound**. They were taken on an Apple Silicon laptop;
Cloudflare's edge runs server-class x86, which is very unlikely to be faster
per core at this. So the real margin is worse than the table.

A password on the free tier is therefore not a thing we can do properly. We can
do it badly — pick an iteration count that fits and accept a hash that is
cheaper to attack than current guidance — but "the shop's admin password is
weakly hashed because of a CPU quota" is not a sentence worth writing.

Meanwhile the alternative is 170× cheaper. Verifying a WebAuthn assertion is one
ECDSA P-256 signature check at 0.044 ms, which is free by comparison, and it is
phishing-resistant in a way no password is. Cloudflare Access would also cost
zero Worker CPU because it authenticates at the edge before the request arrives
— but it needs a Zero Trust organisation, an application and a policy, none of
which the Deploy button can provision ([ADR-0021](0021-install-by-button-update-by-pull-request.md)),
so it cannot be the default for someone who does not use a terminal.

## Decision

**Passkeys are the primary admin authentication.** A WebAuthn credential is
registered during first-run setup and verified with one ECDSA check per login.
Sessions are a cookie signed with `SESSION_SECRET` via HMAC, at 0.003 ms per
request, which is indistinguishable from free.

**An emailed one-time code is the recovery path**, for a lost device or a second
volunteer who needs in. It costs an email and no CPU. It is deliberately not the
primary path, because a fresh install has no email provider configured yet.

**Cloudflare Access is supported and documented for anyone who wants it**, and
recommended for a shop with several staff. When Access is in front of `/admin`,
thela trusts its assertion header and skips its own check entirely.

**No password. Not at a reduced iteration count, not as a fallback.** If the
free-tier budget cannot afford to hash a password properly, the answer is to not
have a password, rather than to have a weak one.

## Consequences

Admin login gets cheaper, safer and less to explain: there is no password to
choose, forget, reuse, or phish.

We take on WebAuthn. It is more code than `bcrypt.compare` — attestation
parsing, challenge storage, credential records, and the awkward parts around
registering a second device. There are no dependencies for it in the bundle
budget worth taking, so it is ours to write and ours to get right.

Recovery becomes the sharp edge. A volunteer whose phone is lost, with an email
provider that was never configured, is locked out of their own shop. The setup
wizard must therefore insist on a recovery address before it will finish, and
that is a step we would otherwise have let people skip.

A shop that upgrades to Workers Paid could use a password if it wanted. We will
not build it. Two auth paths is worse than one, and the cheap one is also the
better one.

The measurement should be repeated on real Cloudflare hardware before the first
release. If ECDSA verify turns out to be materially more expensive at the edge
than measured here, nothing about the decision changes — PBKDF2 gets worse by
the same factor — but the session-cookie budget is worth confirming.
