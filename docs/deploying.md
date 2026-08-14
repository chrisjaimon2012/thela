# Deploying a shop

Read the first section before you click anything. It costs two minutes and
saves an afternoon.

## Do the domain first

**Set your custom domain before you run the setup wizard.** Not after.

A passkey is bound to the exact hostname it was created on. If you set up your
shop on `thela-abc.workers.dev` and later move it to `myshop.com`, the passkey
you registered will not work on the new address — the browser will not even
offer it — and you will need a recovery code to get back in. If email is not
configured yet either, there is no way back in at all short of editing the
database by hand.

This is not a thela quirk. It is how WebAuthn works everywhere, and it is the
single most likely way to lock yourself out.

So the order is:

1. Deploy (the shop is live on `*.workers.dev`, unclaimed).
2. Add your custom domain to the Worker.
3. **Then** open `https://yourdomain.com/admin/setup` and claim it.

If you have already claimed a shop on `workers.dev` and want to move, sign in
on the old address first, add your domain, then register a new passkey on the
new address before the old session expires.

## What you need

* A Cloudflare account. The free plan is enough.
* A GitHub account, for the Deploy button. (Or just a terminal — see below.)
* Two values you invent yourself, both prompted at deploy time:
  * `ADMIN_SETUP_TOKEN` — anything long and random. It stops a stranger
    claiming your shop in the window between deploying and setting up. You need
    it once.
  * `SESSION_SECRET` — anything long and random, different from the above.

You do **not** need a card. A default install declares no R2 bucket, because
R2's free tier still requires completing a checkout flow. The trade is that your
shop starts with no product photographs; everything else works. See
[ADR-0021](decisions/0021-install-by-button-update-by-pull-request.md).

## The button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chrisjaimon2012/thela)

Cloudflare copies this repository into your own GitHub account, creates the
database, asks for the two values above, builds, and deploys.

**If the deploy finishes but your shop shows Cloudflare's "Hello World" page**,
you have hit [an open Cloudflare bug](https://github.com/cloudflare/workers-sdk/issues/14553)
where the source copy silently fails while the dashboard reports success. The
giveaway is a repository containing only a README and a wrangler config. Delete
the Worker and the repository it created, and use the manual path below.

## By hand

Slower, and it tells you what went wrong when something does.

```bash
git clone https://github.com/chrisjaimon2012/thela.git && cd thela
npm install
npx wrangler login
npx wrangler d1 create thela          # paste the id into wrangler.jsonc
npx wrangler secret put ADMIN_SETUP_TOKEN
npx wrangler secret put SESSION_SECRET
npm run deploy
```

`npm run deploy` applies the database migrations first, deploys the shop, then
tries to deploy the ops Worker. If that last step fails it says so and exits
zero — see below for what you lose.

## After it is up

**1. Add your domain.** Workers → your worker → Settings → Domains & Routes.
Then, and only then, visit `/admin/setup`.

**2. Claim the shop.** `https://yourdomain.com/admin/setup`. It asks for your
setup token, your name and an email address. Use an address you will still have
in two years — it is how you get back in if you lose your device.

**3. Set up email.** Until you do, a lost device means a locked shop, because
recovery codes have nowhere to go. Two options:

* **Cloudflare Email Routing** — free, no third party. Works only for addresses
  you have verified as destinations in your zone, which is fine for your own
  recovery codes and alerts, and not enough for customer mail.
* **Resend** or similar — needed for order confirmations to customers. Set
  `RESEND_API_KEY` as a secret.

**4. Add a second passkey.** `/admin/passkeys`. Two is the number that stops a
lost phone becoming an emergency.

## The ops Worker

thela deploys two Workers. The storefront serves pages; `thela-ops` handles
bank credit alert emails and the background timers. They exist separately
because the Astro adapter's generated entry has nowhere to put an `email` or
`scheduled` handler — see
[ADR-0023](decisions/0023-a-second-worker-for-email-and-cron.md).

If the ops Worker did not deploy, your shop still works completely, except:

* bank alert emails are not read, so payments are not confirmed automatically —
  mark them paid yourself, or upload a statement;
* unpaid orders are not released on a timer, so they hold their stock and their
  amount slot until you cancel them;
* nothing watches for trouble.

To add it later, set `database_id` in `workers/ops/wrangler.jsonc` to the same
database your shop uses, then:

```bash
npm run build && npm run deploy:ops
```

## Updates

Installed shops get updates as a pull request. A scheduled action checks
upstream weekly and opens a PR against your own copy with a plain-language
summary. Read it, click Merge, and Cloudflare rebuilds. Nothing changes on your
shop until you do.

This exists because the Deploy button *copies* rather than forks, so there is no
"Sync fork" button to press.

## Known gaps

Honest list, as of this writing:

* Whether the Deploy button can provision the ops Worker at all is **unverified**.
  It reads one wrangler configuration, and the ops Worker has its own. Assume it
  will not until somebody has watched it.
* The setup wizard collects a recovery address but does not yet verify it. A typo
  there is not discovered until you need it.
* `database_id` in `wrangler.jsonc` ships as a placeholder for local development.
  The button is expected to rewrite it; if your first deploy fails with a
  database-not-found error, that is why, and the fix is to paste the real id.
