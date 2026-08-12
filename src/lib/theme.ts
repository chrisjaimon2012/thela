/**
 * The storefront's appearance, as data.
 *
 * A vendor picks a preset and, if they want, one accent colour. Everything else
 * — button text, link colour, price colour, borders, the whole thing — is
 * derived. That is the entire design, and it is a deliberate inversion of what
 * comparable products do: Ecwid ships independent colour-button, colour-link,
 * colour-price and colour-foreground fields, and every one of them will happily
 * let a shopkeeper make "Add to cart" invisible. One picker plus the eight
 * lines of maths in `contrast()` below removes nine settings and makes that
 * failure structurally impossible.
 *
 * WHY THIS IS FIVE LINES OF ASTRO AND NOT A BUILD SYSTEM
 *
 * There is no Tailwind. Components already write `background: var(--accent)`
 * and `border-radius: var(--radius)` directly, so a runtime value moves them.
 * minshop's `--color-brand` sits inside a Tailwind v4 `@theme` block, which
 * GENERATES `bg-brand` at build time — no runtime value can touch it, and a
 * colour change means a redeploy. Never introduce a utility generator over
 * these tokens or that property is lost.
 *
 * DARK MODE IS AUTHORED, NOT DERIVED
 *
 * Each preset ships a hand-tuned dark palette. Deriving one by inverting an
 * arbitrary vendor colour produces muddy, low-contrast results and is the
 * fastest route to "the site is broken". The browser picks between them via
 * `prefers-color-scheme`; we never sniff the client hint server-side, because
 * that would need a `Vary` header and would double every edge cache key.
 *
 * INJECTION
 *
 * The output of `themeVars()` goes into `set:html`, which does not escape.
 * Every value is therefore re-validated HERE, at render time, not merely when
 * it was written — a row edited directly in the D1 console must not be able to
 * close the style element. Anything that fails validation falls back to the
 * preset. See `hex()` and `pick()`.
 */

/** The five colours a palette needs. Everything else is derived from them. */
export interface Palette {
  paper: string;
  ink: string;
  ink2: string;
  line: string;
  accent: string;
}

export interface Preset {
  id: string;
  /** Shown in the admin. The vendor picks by name, not by hex. */
  label: string;
  /** Who this is for, in one line. */
  note: string;
  light: Palette;
  dark: Palette;
  font: FontId;
  radius: RadiusId;
  cardRatio: CardRatioId;
  cardFit: CardFitId;
}

export const FONTS = {
  system: {
    label: 'System',
    stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  serif: {
    label: 'Serif',
    stack: 'Georgia, "Noto Serif", "Times New Roman", serif',
  },
  grotesque: {
    label: 'Grotesque',
    stack: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif',
  },
} as const;

// Four, not the three a purist would ship. `subtle` exists because it is what
// the storefront already looked like, and `plain` has to reproduce that exactly
// for "reset to defaults" to be a safe button.
export const RADII = { sharp: '0', subtle: '3px', soft: '8px', round: '16px' } as const;

/** `auto` lets the image decide its own shape, which never crops anything. */
export const CARD_RATIOS = {
  auto: 'auto',
  square: '1 / 1',
  tall: '3 / 4',
  taller: '2 / 3',
  wide: '4 / 3',
} as const;

export const CARD_FITS = { cover: 'cover', contain: 'contain' } as const;

export type FontId = keyof typeof FONTS;
export type RadiusId = keyof typeof RADII;
export type CardRatioId = keyof typeof CARD_RATIOS;
export type CardFitId = keyof typeof CARD_FITS;
export type ThemeMode = 'light' | 'dark' | 'auto';

/**
 * The presets.
 *
 * `plain` is exactly what the storefront looked like before theming existed, so
 * a shop with an empty setting table renders byte-identically and "reset to
 * defaults" is provably safe.
 *
 * There is deliberately no "Night" preset: dark is a MODE, and every preset
 * here ships a dark palette. A separate dark preset would give a vendor two
 * ways to express one idea and guarantee they pick the wrong one.
 */
export const PRESETS: Record<string, Preset> = {
  plain: {
    id: 'plain',
    label: 'Plain',
    note: 'Quiet and neutral. Lets the products do the talking.',
    light: { paper: '#fdfdfc', ink: '#16181d', ink2: '#565d6b', line: '#e3e5e2', accent: '#1a5c3a' },
    dark: { paper: '#14161a', ink: '#ecefeb', ink2: '#a2aaa6', line: '#272b30', accent: '#6fc79a' },
    font: 'system',
    radius: 'subtle',
    cardRatio: 'taller',
    cardFit: 'cover',
  },
  parish: {
    id: 'parish',
    label: 'Parish',
    note: 'Warm and handmade. For church stalls, craft co-ops and charity shops.',
    light: { paper: '#fbf8f2', ink: '#2a2620', ink2: '#6b6355', line: '#e6ddcd', accent: '#1f5d43' },
    dark: { paper: '#1a1713', ink: '#f0e9dd', ink2: '#a89e8c', line: '#2f2a22', accent: '#7fc4a4' },
    font: 'serif',
    radius: 'soft',
    cardRatio: 'taller',
    cardFit: 'cover',
  },
  studio: {
    id: 'studio',
    label: 'Studio',
    note: 'High contrast, nothing cropped. For prints, art and photography.',
    light: { paper: '#ffffff', ink: '#0a0a0a', ink2: '#6e6e6e', line: '#e5e5e5', accent: '#0a0a0a' },
    dark: { paper: '#0a0a0a', ink: '#fafafa', ink2: '#9b9b9b', line: '#242424', accent: '#fafafa' },
    font: 'grotesque',
    radius: 'sharp',
    // `contain` is the point of this preset: a print with its head cropped off
    // is the complaint it exists to prevent.
    cardRatio: 'square',
    cardFit: 'contain',
  },
  market: {
    id: 'market',
    label: 'Market',
    note: 'Bright and dense. For food, produce and lots of small items.',
    light: { paper: '#fffdf7', ink: '#241d14', ink2: '#6d6153', line: '#eee3d0', accent: '#c2410c' },
    dark: { paper: '#16120d', ink: '#f7efe4', ink2: '#a99b88', line: '#2b241b', accent: '#fb923c' },
    font: 'system',
    radius: 'round',
    cardRatio: 'square',
    cardFit: 'cover',
  },
};

export const DEFAULT_PRESET = 'plain';

/** What `themeVars` needs. A subset of `Settings`, so callers just pass it. */
export interface ThemeSettings {
  themePreset: string;
  themeMode: string;
  /** Empty means "use the preset's". */
  themeAccent: string;
  themeFont: string;
  themeRadius: string;
  cardRatio: string;
  cardFit: string;
}

/**
 * Render the `:root` block.
 *
 * Roughly 400 bytes, emitted into `<head>` before any body content, with no
 * JavaScript — which is why there is no flash of unstyled content and why a
 * manual light/dark toggle is rejected: a toggle needs a render-blocking script
 * reading localStorage before first paint, and that is the only way to
 * reintroduce the flash this design otherwise cannot have.
 */
export function themeVars(s: ThemeSettings): string {
  const preset = PRESETS[s.themePreset] ?? PRESETS[DEFAULT_PRESET]!;
  const mode = pick<ThemeMode>(s.themeMode, ['light', 'dark', 'auto'], 'auto');

  const font = FONTS[pick<FontId>(s.themeFont, keys(FONTS), preset.font)].stack;
  const radius = RADII[pick<RadiusId>(s.themeRadius, keys(RADII), preset.radius)];
  const ratio = CARD_RATIOS[pick<CardRatioId>(s.cardRatio, keys(CARD_RATIOS), preset.cardRatio)];
  const fit = CARD_FITS[pick<CardFitId>(s.cardFit, keys(CARD_FITS), preset.cardFit)];

  const shape = `--radius:${radius};--card-ratio:${ratio};--card-fit:${fit};--font:${font}`;
  const accent = hex(s.themeAccent);

  const light = block(preset.light, accent);
  const dark = block(preset.dark, accent);

  if (mode === 'light') return `:root{${light};${shape}}`;
  if (mode === 'dark') return `:root{${dark};${shape}}`;
  return `:root{${light};${shape}}@media (prefers-color-scheme:dark){:root{${dark}}}`;
}

function block(p: Palette, accentOverride: string | null): string {
  const accent = accentOverride ?? p.accent;
  return [
    `--paper:${p.paper}`,
    `--ink:${p.ink}`,
    `--ink-2:${p.ink2}`,
    `--line:${p.line}`,
    `--accent:${accent}`,
    `--on-accent:${onAccent(accent, p.ink, p.paper)}`,
  ].join(';');
}

/**
 * The colour that text on the accent must be.
 *
 * This is the derivation that makes an unreadable button impossible. Try the
 * palette's own paper and ink against the accent and take whichever has the
 * better contrast ratio; if neither clears WCAG AA for large text, fall back to
 * plain white or black, one of which always will.
 */
export function onAccent(accent: string, ink: string, paper: string): string {
  const candidates = [paper, ink, '#ffffff', '#000000'];
  let best = candidates[0]!;
  let bestRatio = 0;
  for (const c of candidates) {
    const r = contrast(accent, c);
    if (r > bestRatio) {
      bestRatio = r;
      best = c;
    }
    // AAA for large text. Good enough is good enough — preferring the vendor's
    // own palette over pure white keeps the design coherent.
    if (bestRatio >= 4.5) break;
  }
  return best;
}

/** WCAG 2.x contrast ratio. Exported so the admin can show the number. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG relative luminance: sRGB linearisation, then the standard weights. */
function luminance(hexColour: string): number {
  const n = parseInt(hexColour.slice(1), 16);
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

/**
 * Six-digit hex or nothing.
 *
 * The only string from the database that reaches the stylesheet as free text,
 * so it is the only place an injection could start. `#fff` is rejected rather
 * than expanded — a stricter rule is easier to be sure about than a lenient one
 * with an expansion step, and the admin's colour input emits six digits anyway.
 */
function hex(value: string): string | null {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
}

/** Membership check with a fallback. Nothing unrecognised reaches the output. */
function pick<T extends string>(value: string, allowed: readonly string[], fallback: T): T {
  return (allowed.includes(value) ? value : fallback) as T;
}

const keys = (o: object): string[] => Object.keys(o);
