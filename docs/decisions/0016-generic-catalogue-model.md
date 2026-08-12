# ADR-0016: A generic catalogue — products, named option axes, stock decoupled from variants

* Status: Accepted
* Date: 2026-08-12
* Supersedes part of [ADR-0008](0008-unguarded-stock-reservation.md)'s framing (the mechanism stands; the "frame blank" vocabulary does not)

## Context

The first shop sells framed Bible verses: a *design* is the product, and *frame
size* and *frame colour* are the variants. Stock is unusual there — sixty
designs share six physical frame blanks, so counting stock per sellable variant
would mean 360 numbers nobody can keep honest.

That shaped the schema, and it over-fitted. A clothing shop has a *design* as
the product and *size* as the variant, with stock per variant and nothing
shared. A potter has one-off products with no variants at all. thela is for all
of them, and a vendor must be able to decide for themselves what a product is
and what a variant is.

For reference, minshop models variants as a single flat axis — a `label` of
`"Small"` or `"Red"` with one `variant_label` naming the group. That is simpler
than what we had, and cannot express size × colour at all.

## Decision

**Products carry up to three named option axes.** A product declares its own
axis names (`Size`, `Colour`, `Material`); a variant carries a value for each.
Three is Shopify's long-standing cap and covers the overwhelming majority of
small-business catalogues.

**Stock is a separate entity that variants reference.** The default is one
stock item per variant, created automatically. Where several variants genuinely
consume the same physical thing — the frame-blank case — many variants may point
at one stock item. That is a configuration, not the model's shape.

**A product with no options is legal** and has exactly one implicit variant.

## Consequences

The same schema serves a framer, a clothing shop and a potter without any of
them learning the others' vocabulary. `stock` becomes `stock_item`, and nothing
in the code says "frame".

Shared stock stops being the default and becomes an advanced option, which is
the right emphasis: most vendors want one-variant-one-count, and that now
happens without them thinking about it.

The three-axis cap is a real limit. A vendor needing four axes must model one as
a separate product. We accept that, having watched Shopify accept it for a
decade.

The `CHECK (reserved <= on_hand)` reservation mechanism is unchanged — only the
table it sits on is renamed.
