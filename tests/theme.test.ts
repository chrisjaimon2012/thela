import { describe, expect, it } from 'vitest';
import {
  CARD_FITS, CARD_RATIOS, FONTS, PRESETS, RADII,
  contrast, onAccent, themeVars, type ThemeSettings,
} from '../src/lib/theme';

/**
 * These tests exist because the contrast maths shipped wrong the first time.
 *
 * `luminance` linearised the red and green channels and forgot blue, leaving it
 * as a raw 0–255 value multiplied by 0.0722. Every colour with any blue in it
 * came out roughly fifty times too bright, so the default green accent measured
 * brighter than white and `--on-accent` resolved to BLACK on dark green. That
 * is precisely the unreadable-button failure the whole one-accent design exists
 * to make impossible, and it was invisible until the rendered CSS was read by
 * eye. Nothing here is decorative.
 */

const base: ThemeSettings = {
  themePreset: 'plain',
  themeMode: 'auto',
  themeAccent: '',
  themeFont: '',
  themeRadius: '',
  cardRatio: '',
  cardFit: '',
};

describe('contrast', () => {
  it('matches the WCAG reference values', () => {
    // Black on white is the definition of 21:1.
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // A colour with a large blue component is where the original bug lived.
    expect(contrast('#0000ff', '#ffffff')).toBeCloseTo(8.59, 1);
    expect(contrast('#1a5c3a', '#ffffff')).toBeCloseTo(7.967, 2);
  });

  it('is symmetric', () => {
    expect(contrast('#1a5c3a', '#ffffff')).toBeCloseTo(contrast('#ffffff', '#1a5c3a'), 10);
  });
});

describe('onAccent', () => {
  it('puts light text on a dark accent, not black', () => {
    const { ink, paper } = PRESETS.plain!.light;
    const chosen = onAccent('#1a5c3a', ink, paper);
    expect(contrast('#1a5c3a', chosen)).toBeGreaterThanOrEqual(4.5);
    expect(chosen).not.toBe('#000000');
  });

  it('puts dark text on a pale accent', () => {
    const { ink, paper } = PRESETS.plain!.light;
    // The classic failure: a vendor picks pale yellow and white text vanishes.
    const chosen = onAccent('#ffe680', ink, paper);
    expect(contrast('#ffe680', chosen)).toBeGreaterThanOrEqual(4.5);
    expect(chosen).not.toBe('#ffffff');
  });

  it('clears AA for large text against every preset accent, in both modes', () => {
    for (const preset of Object.values(PRESETS)) {
      for (const p of [preset.light, preset.dark]) {
        const chosen = onAccent(p.accent, p.ink, p.paper);
        expect(
          contrast(p.accent, chosen),
          `${preset.id} accent ${p.accent} resolved to ${chosen}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('never fails, whatever accent a vendor picks', () => {
    // Sweep the colour cube. There is always a readable answer, and the
    // derivation must find it rather than trusting the vendor to.
    const { ink, paper } = PRESETS.plain!.light;
    for (let r = 0; r < 256; r += 51) {
      for (let g = 0; g < 256; g += 51) {
        for (let b = 0; b < 256; b += 51) {
          const accent = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
          const chosen = onAccent(accent, ink, paper);
          expect(contrast(accent, chosen), `${accent} -> ${chosen}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

describe('themeVars', () => {
  it('reproduces the pre-theming storefront for a shop that has chosen nothing', () => {
    const css = themeVars(base);
    expect(css).toContain('--paper:#fdfdfc');
    expect(css).toContain('--ink:#16181d');
    expect(css).toContain('--accent:#1a5c3a');
    // The values the static stylesheet already used, so "reset to defaults"
    // is provably a no-op rather than a redesign.
    expect(css).toContain('--radius:3px');
    expect(css).toContain('--card-ratio:2 / 3');
    expect(css).toContain('--card-fit:cover');
  });

  it('emits a dark block only in auto and dark modes', () => {
    expect(themeVars(base)).toContain('prefers-color-scheme:dark');
    expect(themeVars({ ...base, themeMode: 'light' })).not.toContain('prefers-color-scheme');
    const dark = themeVars({ ...base, themeMode: 'dark' });
    expect(dark).not.toContain('prefers-color-scheme');
    expect(dark).toContain('--paper:#14161a');
  });

  it('lets the accent override both palettes and recomputes contrast for each', () => {
    const css = themeVars({ ...base, themeAccent: '#FFE680' });
    expect(css).toContain('--accent:#ffe680');
    // Two blocks, each with an --on-accent that suits its own palette.
    const chosen = [...css.matchAll(/--on-accent:(#[0-9a-f]{6})/g)].map((m) => m[1]!);
    expect(chosen).toHaveLength(2);
    for (const c of chosen) expect(contrast('#ffe680', c)).toBeGreaterThanOrEqual(4.5);
  });

  describe('injection', () => {
    // Every one of these is a value that could reach the database directly,
    // through a bug in the admin form or through someone editing D1 by hand.
    const hostile = [
      'red}</style><script>alert(1)</script><style>',
      '#fff;background:url(https://evil.example/x)',
      'expression(alert(1))',
      '#12345',       // five digits
      '#1234567',     // seven
      '#GGGGGG',      // not hex
      'rgb(0,0,0)',
      '',
      '  ',
      'javascript:alert(1)',
    ];

    it('never lets a hostile accent reach the stylesheet', () => {
      for (const accent of hostile) {
        const css = themeVars({ ...base, themeAccent: accent });
        expect(css, accent).not.toContain('<');
        expect(css, accent).not.toContain('script');
        expect(css, accent).not.toContain('url(');
        expect(css, accent).not.toContain('expression');
        // Falls back to the preset rather than emitting anything of its own.
        expect(css, accent).toContain('--accent:#1a5c3a');
      }
    });

    it('never lets a hostile enum reach the stylesheet', () => {
      for (const value of hostile) {
        const css = themeVars({
          ...base,
          themeMode: value, themeFont: value, themeRadius: value,
          cardRatio: value, cardFit: value, themePreset: value,
        });
        expect(css, value).not.toContain('<');
        // Braces only where this function puts them: the :root block, the
        // media query's inner :root, and the media query itself. A fourth
        // means a value escaped into the output.
        expect(css.split('}').length - 1, value).toBeLessThanOrEqual(3);
      }
    });

    it('produces a balanced block for every legal combination', () => {
      for (const themePreset of Object.keys(PRESETS)) {
        for (const themeMode of ['light', 'dark', 'auto']) {
          for (const themeRadius of Object.keys(RADII)) {
            for (const cardRatio of Object.keys(CARD_RATIOS)) {
              const css = themeVars({
                ...base, themePreset, themeMode, themeRadius, cardRatio,
                themeFont: Object.keys(FONTS)[0]!,
                cardFit: Object.keys(CARD_FITS)[0]!,
              });
              expect(css.split('{').length, css).toBe(css.split('}').length);
              expect(css.startsWith(':root{'), css).toBe(true);
            }
          }
        }
      }
    });
  });

  it('stays small enough to inline in every page', () => {
    // It ships in the <head> of every response, so its size is multiplied by
    // every page view. 700 bytes is generous; a regression past it means
    // someone added a setting that should have been derived.
    for (const themePreset of Object.keys(PRESETS)) {
      expect(themeVars({ ...base, themePreset }).length).toBeLessThan(700);
    }
  });
});
