--------------------------------------------------------------------------------
-- ADMIN IDENTITY
--
-- Passkeys, not passwords. Not a preference — a measurement. PBKDF2 at OWASP's
-- recommended 600,000 iterations costs 45 ms of CPU against the Workers free
-- plan's 10 ms budget, and even 100,000 costs 7.5 ms, leaving nothing for the
-- page being logged into. Verifying a passkey costs 0.044 ms. See ADR-0022.
--
-- There is deliberately no password column. Not hashed, not optional, not
-- "for now". A column that exists gets used.
--------------------------------------------------------------------------------

CREATE TABLE admin_user (
  id         TEXT PRIMARY KEY,
  -- Also the recovery channel: a one-time code goes here when every passkey is
  -- lost. The setup wizard refuses to finish without one, because a volunteer
  -- with a broken phone and no recovery address is locked out of their own shop.
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL DEFAULT '',
  -- 'owner' can add and remove other admins. 'staff' cannot.
  role       TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'staff')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen  TEXT
) STRICT;

CREATE TABLE admin_credential (
  -- The raw credential id from the authenticator, base64url. Globally unique
  -- by construction, which is what lets a login start from the credential
  -- alone and never ask "who are you?" first.
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,

  -- SPKI DER, base64url, straight from the browser's getPublicKey(). Storing
  -- the already-parsed form is why this codebase needs no CBOR decoder: the
  -- browser hands over a key WebCrypto can import directly.
  public_key   TEXT NOT NULL,
  -- COSE algorithm identifier: -7 is ES256, -257 is RS256.
  algorithm    INTEGER NOT NULL,

  -- The authenticator's own counter. It must never go backwards; if it does,
  -- the credential has been cloned. Many modern authenticators pin it at 0 and
  -- opt out, which is legitimate and handled.
  sign_count   INTEGER NOT NULL DEFAULT 0,

  -- What the shopkeeper calls it: "my phone", "the shop laptop". Without this,
  -- revoking a lost device means guessing between identical rows.
  label        TEXT NOT NULL DEFAULT '',
  transports   TEXT NOT NULL DEFAULT '',

  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
) STRICT;

CREATE INDEX admin_credential_by_user ON admin_credential(user_id);

--------------------------------------------------------------------------------
-- RECOVERY
--
-- One-time codes, hashed. A code sitting in plain text in the database is a
-- password that expires — worse than a password, because nobody would think to
-- rotate it after a leaked backup.
--------------------------------------------------------------------------------

CREATE TABLE admin_recovery (
  -- SHA-256 of the code. Cheap to verify (0.003 ms) and the code is
  -- high-entropy and short-lived, so there is nothing for a slow hash to buy.
  code_hash  TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

--------------------------------------------------------------------------------
-- AUDIT
--
-- Who did what. Small, append-only, and the first thing anyone will want when
-- an order was marked paid and nobody remembers doing it.
--------------------------------------------------------------------------------

CREATE TABLE admin_action (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  actor    TEXT NOT NULL,
  action   TEXT NOT NULL,
  -- What it happened to: an order id, a credential id, a setting key.
  subject  TEXT,
  detail   TEXT,
  at       TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX admin_action_recent ON admin_action(at DESC);
