# tracking_number_data — vendored

Source: https://github.com/jkeen/tracking_number_data
Licence: MIT (see LICENSE in this directory)
Pinned at: cb4af5736368a1821833ef6e792ffd4f7a3e2930 (2026-02-19)

## Why this is vendored rather than an npm dependency

It is data, not code. There is no runtime to import — the upstream repo ships
JSON plus a Ruby gem and a Go embed, none of which help a Worker. Vendoring
gives us a reviewable diff when we update, and it removes a supply-chain
dependency from the one place in the system that decides which URL a customer
is sent to.

Upstream is quiet by nature: the last data change before this pin was
2025-08-21. Silence here means the world's carriers have not changed their
tracking number formats, which is the normal state of affairs. Do not read it
as abandonment.

## What we use, and what we drop

`scripts/build-tracking-data.mjs` compiles these files into
`src/lib/shipping/tracking-data.generated.ts`, keeping only the pattern, the
check-digit rule, the tracking URL and — for S10 — the 191-entry country to
postal-operator map. Service-type lookups, descriptions and test numbers are
dropped from the bundle; the test numbers are read straight from here by
`tests/tracking.test.ts`, which is the point of keeping the raw files.

The S10 entry is the valuable one. It is the Universal Postal Union standard,
so one pattern covers India Post, La Poste, Royal Mail and 188 other national
operators — the whole long tail, without an adapter for any of them.

## Updating

    cd /tmp && git clone --depth 1 https://github.com/jkeen/tracking_number_data
    cp -r tracking_number_data/couriers <thela>/vendor/tracking-number-data/
    npm run build:tracking && npm test

Then update the pin above with the new commit and date.
