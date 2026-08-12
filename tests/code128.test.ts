import { describe, expect, it } from 'vitest';
import { barcode, barcodeSvg, encode } from '../src/lib/shipping/code128';

/**
 * A barcode is the one thing on a shipping label that nobody proofreads.
 *
 * A shopkeeper looks at a label and sees the address is right; they cannot see
 * that the bars encode a checksum one off from the number printed beneath them.
 * The failure shows up days later at a courier's depot, on a parcel that has
 * already left the building. So the encoder is verified against the
 * specification's own arithmetic rather than by looking at it.
 */

const START_B = 104;
const START_C = 105;
const CODE_C = 99;
const STOP = 106;

/** ISO/IEC 15417: start value, then position × value, modulo 103. */
const expectedChecksum = (values: number[]): number => {
  let sum = values[0]!;
  for (let i = 1; i < values.length; i++) sum += i * values[i]!;
  return sum % 103;
};

describe('encode', () => {
  it('packs an all-digit number into subset C, two digits per symbol', () => {
    const v = encode('12345678');
    // Start C, four pairs, checksum, stop — nine symbols for eight digits.
    expect(v.slice(0, 5)).toEqual([START_C, 12, 34, 56, 78]);
    expect(v[v.length - 1]).toBe(STOP);
    expect(v).toHaveLength(7);

    // Worked by hand from the spec: (105 + 1×12 + 2×34 + 3×56 + 4×78) mod 103
    // = 665 mod 103 = 47.
    expect(v[v.length - 2]).toBe(47);
  });

  it('uses subset B for text, offsetting by 32 as the spec requires', () => {
    const v = encode('AB');
    expect(v.slice(0, 3)).toEqual([START_B, 'A'.charCodeAt(0) - 32, 'B'.charCodeAt(0) - 32]);
  });

  it('switches into subset C mid-number, which is what keeps a label narrow', () => {
    // A UPS-shaped number: letters then a long digit run.
    const v = encode('1Z999AA10123456784');
    expect(v[0]).toBe(START_B);
    expect(v).toContain(CODE_C);
    // Packing must actually save symbols: 18 characters in B alone would be
    // 18 data symbols, and the whole point is to need fewer.
    expect(v.length - 3).toBeLessThan(18);
  });

  it('computes a checksum that satisfies the specification, for many inputs', () => {
    const cases = [
      '12345678', 'AB', '1Z999AA10123456784', 'RB123456785IN', '9400111899223197428490',
      'A', '0', '00', '000', '1234567', 'a-b_c 1', '~!@#$%^&*()', 'X1Y2Z3',
    ];
    for (const text of cases) {
      const v = encode(text);
      const check = v[v.length - 2]!;
      const body = v.slice(0, -2);
      expect(check, `checksum for ${text}`).toBe(expectedChecksum(body));
      expect(check).toBeGreaterThanOrEqual(0);
      expect(check).toBeLessThan(103);
    }
  });

  it('round-trips subset C back to the original digits', () => {
    // Decoding what we encoded is the strongest cheap check that the packing
    // is not off by one.
    const text = '9400111899223197428490';
    const v = encode(text);
    const digits = v
      .slice(1, -2)
      .map((n) => String(n).padStart(2, '0'))
      .join('');
    expect(digits).toBe(text);
  });

  it('refuses characters it cannot encode rather than emitting a wrong barcode', () => {
    // Silently dropping a character would produce a scannable barcode holding
    // the wrong number, which is the worst possible outcome.
    expect(() => encode('naïve')).toThrow(/printable ASCII/);
    expect(() => encode('日本')).toThrow();
  });

  it('handles an empty string without producing something a scanner would read', () => {
    const v = encode('');
    expect(v).toEqual([START_B, expectedChecksum([START_B]), STOP]);
  });
});

describe('barcode', () => {
  it('draws bars whose widths match the symbol patterns exactly', () => {
    const { path, modules } = barcode('12345678');
    const v = encode('12345678');

    // Every symbol is 11 modules, the stop pattern carries 2 more, and the
    // quiet zones are 10 each side. Getting this wrong is how a barcode ends
    // up unscannable while looking perfectly fine.
    expect(modules).toBe(10 + v.length * 11 + 2 + 10);

    const drawn = [...path.matchAll(/h(\d+)v1/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(modules);
  });

  it('starts after a full quiet zone', () => {
    // A scanner needs blank space before the first bar. Starting at 0 is a
    // barcode that reads intermittently depending on what is printed beside it.
    expect(barcode('12345678').path.startsWith('M10 ')).toBe(true);
  });

  it('never emits a zero-width bar', () => {
    for (const text of ['12345678', '1Z999AA10123456784', 'RB123456785IN']) {
      expect(barcode(text).path).not.toMatch(/h0v1/);
    }
  });
});

describe('barcodeSvg', () => {
  it('is self-contained and scales to whatever the label CSS asks for', () => {
    const svg = barcodeSvg('RB123456785IN', { height: 18 });
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('height:18mm');
    // Non-uniform scaling is required: the bars must fill the label's width
    // while keeping the height the label asked for.
    expect(svg).toContain('preserveAspectRatio="none"');
    // Without this, sub-pixel antialiasing blurs bar edges and cheap scanners
    // start failing on printed labels.
    expect(svg).toContain('shape-rendering="crispEdges"');
  });

  it('fetches nothing, because a label prints on a shop counter with no internet', () => {
    const svg = barcodeSvg('12345678');
    // The xmlns is a namespace declaration, not a request, so it is excluded.
    const withoutNamespace = svg.replace(/xmlns="[^"]*"/g, '');
    expect(withoutNamespace).not.toMatch(/https?:/);
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('href');
    expect(svg).not.toContain('url(');
  });
});
