# Letting other people run the shop

Two ways, and which you want depends on how many people there are.

| | Passkeys | Cloudflare Access |
|---|---|---|
| Setup | None | A Zero Trust application and one policy |
| Needs a custom domain | No | **Yes** |
| Sign-in | Fingerprint or face, one touch | Your Google, GitHub or email OTP |
| Removing somebody | Delete them in thela | Delete them in Access *and* thela |
| Worker CPU per request | 0.044 ms | 0 |

**One or two people: use passkeys.** It is what a fresh install already does.

**Three or more, or people who come and go: use Access.** It gives you SSO with
accounts they already have, one place to cut somebody off across everything, and
a login audit thela does not have to keep.

## What a person can do

Two roles, and the line between them is money.

**Staff** run the shop day to day — read orders and customers, mark payments
received, settle credits, dispatch parcels, print labels, edit the catalogue and
the shop's appearance.

**Owners** can additionally change **where money goes** and **who else gets in**.

That line is not about seniority. `payment.upi_vpa` decides which account every
future customer payment lands in, and somebody who changes it redirects your
income while the shop carries on looking completely normal — nobody notices
until you check your bank. So it belongs to the person whose bank account it is.
Currency, tax registration and the shop's legal name are owner-only for the same
reason: they change what the shop claims about itself.

There is always at least one owner. thela refuses to remove or demote the last
one, because a shop with no owner cannot be configured and cannot be recovered
into — there would be no account left to recover to.

## Adding somebody

**Admin → People → Invite**, with their email address and a role.

An invitation is not an email with a link. It is an entry on a list of addresses
you have allowed. That person then either registers their own passkey against
it, or signs in through Access with that address. The same list serves both, so
removing them removes both at once — and their passkeys go with them, because a
credential left behind is a revoked person who can still sign in.

## Setting up Cloudflare Access

You need a custom domain on the shop first; Access cannot protect a
`*.workers.dev` address.

**1. Create the application.** Zero Trust → Access controls → Applications → Add
an application → Self-hosted. Give it your shop's hostname and the path `/admin`.

**2. Add a policy.** An application with no policy denies everything. One Allow
rule is enough to begin:

| Action | Rule type | Selector | Value |
|---|---|---|---|
| Allow | Include | Emails | the addresses of your staff |

**3. Copy the AUD tag** from the application's overview.

**4. Tell thela**, so it can verify what Access sends:

```bash
npx wrangler secret put ACCESS_TEAM_DOMAIN   # https://<your-team>.cloudflareaccess.com
npx wrangler secret put ACCESS_POLICY_AUD    # the AUD tag from step 3
```

**5. Add the same people in Admin → People.** Access decides who reaches the
admin; thela decides what they can do once there. Two independent lists is
deliberate — somebody removed from either is out.

### Why step 4 is not optional

Without those two values thela **ignores Access entirely** and falls back to
passkeys. That is on purpose, and it is also the only safe behaviour.

Access adds a `Cf-Access-Authenticated-User-Email` header to requests that pass
through it. Anybody at all can add that header to a request that does not — and
your Worker is still reachable at its `workers.dev` address and at every other
route bound to it. Trusting the header alone would mean one forged header made
somebody an administrator.

So thela verifies the **signed token** in `Cf-Access-Jwt-Assertion` against your
team's published keys, checking the issuer, the expiry and the audience. The
audience is why the AUD tag is needed: a valid signature only proves Cloudflare
minted the token, not that it minted it for *this* application, so without
pinning it a token from any other application in your Zero Trust organisation
would be accepted here.

Cloudflare put it plainly: *"Validation of the header alone is not sufficient —
the JWT and signature must be confirmed to avoid identity spoofing."*

If you configure only one of the two values, thela treats Access as not
configured rather than half-trusting it. Misconfiguration fails closed.

### Closing the back door

Access protects a hostname, not a Worker. Once your custom domain is live and
Access is in front of it, turn off the `workers.dev` address so nobody can reach
the admin around it:

```jsonc
// wrangler.jsonc
"workers_dev": false
```

Passkey sign-in still works on your custom domain, so this costs nothing.

## Customers never sign in

None of this touches customers. They check out as guests and track their order
from a link in their confirmation email. Accounts are not planned for them —
forced registration costs a small shop sales, and every account is personal data
the shopkeeper becomes responsible for.
