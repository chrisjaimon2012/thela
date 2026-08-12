# ADR-0012: Reject SMS forwarding as a channel

* Status: Accepted
* Date: 2026-08-12

## Context

SMS is the only credit-notification channel in India with a regulatory floor.
RBI/2017-18/15 (6 July 2017) para 5: *"The SMS alerts shall mandatorily be sent
to the customers, while email alerts may be sent, wherever registered."*

That asymmetry explains everything else we found: email coverage is patchy
because it is optional, and only HDFC could be confirmed to email all UPI
credits. SMS would work at every bank, for every vendor, with no GSTIN, no
current account and nobody's permission — an old Android handset running a
forwarder app posting to the shop's Worker.

Mature open-source forwarders exist and the setup is about four steps.

## Decision

We will not support SMS forwarding.

## Consequences

We give up the only universally available real-time channel, and that is a
genuine loss. Shops on banks that do not email UPI credits are left with
statement upload — same-day rather than real-time.

The reason is that it makes a phone load-bearing. The device must stay charged,
in signal, unlocked and exempt from battery optimisation indefinitely; when it
stops, the failure is silent and indistinguishable from a quiet sales day. That
is precisely the failure mode this project exists to avoid. Bank emails and
statements are ordinary bank services; a phone taped to a wall is a workaround
wearing a costume.

Recorded in NON-GOALS.md so it is not re-proposed. If it ever is, the argument
to beat is reliability, not coverage.
