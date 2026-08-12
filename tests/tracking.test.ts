import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detect, identify, normalise, trackingUrl } from '../src/lib/shipping/tracking';

/**
 * Driven by the vendored dataset's OWN fixtures.
 *
 * Every courier file ships `test_numbers.valid` and `test_numbers.invalid`,
 * transcribed from the carriers' specifications. Reading them from `vendor/`
 * rather than copying a handful in here is why the raw files are vendored at
 * all: when the data is updated, these tests immediately exercise whatever came
 * with it, including patterns nobody thought to write a test for.
 *
 * Six check-digit algorithms are ported by hand in tracking.ts. A transcription
 * slip in any one of them would silently mark real tracking numbers invalid —
 * which reads to a shopkeeper as "thela says my courier's number is wrong" and
 * is exactly the sort of thing that erodes trust in software that is otherwise
 * quietly correct.
 */

const DIR = 'vendor/tracking-number-data/couriers';

interface Fixture {
  courier: string;
  courierCode: string;
  name: string;
  valid: string[];
  invalid: string[];
}

const fixtures: Fixture[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .flatMap((file) => {
    const doc = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    return doc.tracking_numbers.map((tn: Record<string, unknown>) => ({
      courier: doc.name as string,
      courierCode: doc.courier_code as string,
      name: tn.name as string,
      valid: ((tn.test_numbers as Record<string, string[]>)?.valid ?? []),
      invalid: ((tn.test_numbers as Record<string, string[]>)?.invalid ?? []),
    }));
  });

describe('the vendored dataset', () => {
  it('is present and covers the global postal tail', () => {
    expect(fixtures.length).toBeGreaterThan(20);
    expect(fixtures.some((f) => f.courierCode === 's10')).toBe(true);
  });
});

describe.each(fixtures)('$courier — $name', ({ courierCode, valid, invalid }) => {
  it.skipIf(valid.length === 0)('accepts its own valid numbers with a good check digit', () => {
    for (const number of valid) {
      const matches = detect(number);
      expect(matches.length, `${number} matched nothing`).toBeGreaterThan(0);
      expect(
        matches.some((m) => m.valid && m.courierCode === courierCode),
        `${number}: no valid match for ${courierCode} (got ${JSON.stringify(
          matches.map((m) => [m.courierCode, m.valid]),
        )})`,
      ).toBe(true);
    }
  });

  it.skipIf(invalid.length === 0)('rejects its own invalid numbers', () => {
    for (const number of invalid) {
      // "Invalid" upstream means: does not validate AS THIS COURIER. A number
      // may still legitimately match some other carrier's pattern, so the
      // assertion is scoped rather than global.
      const asThisCourier = detect(number).filter((m) => m.courierCode === courierCode);
      expect(
        asThisCourier.every((m) => !m.valid),
        `${number} was accepted as valid ${courierCode}`,
      ).toBe(true);
    }
  });
});

describe('S10, which is the whole reason manual shipping works everywhere', () => {
  it('names the national operator from the country code', () => {
    // A real Indian registered-post shape and a French one. The point is that
    // neither needs an adapter, a contract, or a line of carrier code.
    const india = detect('RB123456785IN').find((m) => m.courierCode === 's10');
    expect(india?.courier).toMatch(/India/i);

    const france = detect('RB123456785FR').find((m) => m.courierCode === 's10');
    expect(france?.courier).toMatch(/Poste/i);
  });

  it('refuses a country code that is not a UPU member', () => {
    // Shape is right, country is not a member — so it is not an S10 number,
    // whatever it looks like.
    expect(detect('RB123456785ZZ').some((m) => m.courierCode === 's10')).toBe(false);
  });
});

describe('normalise', () => {
  it('survives how a number is actually pasted off a label', () => {
    expect(normalise('1Z 999 AA1 01 2345 6784')).toBe('1Z999AA10123456784');
    // Hyphens survive, because LaserShip's format ends in a literal "-1".
    expect(normalise('rb-123456785-in')).toBe('RB-123456785-IN');
  });

  it('still recognises a number someone typed with hyphens', () => {
    // Second-pass behaviour: nothing matches as typed, so detect retries
    // without hyphens rather than telling the shopkeeper their number is wrong.
    expect(identify('rb-123456785-in')?.courier).toMatch(/India/i);
  });

  it('recognises a number typed with the spacing from a printed label', () => {
    const spaced = identify('1Z 999 AA1 01 2345 6784');
    expect(spaced?.courierCode).toBe('ups');
    expect(spaced?.valid).toBe(true);
  });
});

describe('trackingUrl', () => {
  it('fills the admin-editable template, which is how an unknown carrier works', () => {
    expect(trackingUrl('https://courier.example/t?id=:tracking', 'AB 123 456 789 IN'))
      .toBe('https://courier.example/t?id=AB123456789IN');
  });

  it('returns null for a template with no placeholder, rather than a wrong link', () => {
    // Silently emailing a customer the carrier's homepage is worse than
    // emailing them no link at all.
    expect(trackingUrl('https://courier.example/track', 'AB123456789IN')).toBeNull();
  });

  it('escapes, so a pasted number cannot break out of the query string', () => {
    expect(trackingUrl('https://x.example/?q=:tracking', 'AB&evil=1')).toBe(
      'https://x.example/?q=AB%26EVIL%3D1',
    );
  });
});

describe('a number nobody recognises', () => {
  it('is not an error — it is the normal case for most of the world', () => {
    // Delhivery numbers have no published check digit and no entry in the
    // dataset. The shop still ships; the admin just uses its URL template.
    expect(detect('1234567890123')).toBeInstanceOf(Array);
    expect(() => detect('')).not.toThrow();
    expect(detect('')).toEqual([]);
    expect(() => detect('<script>')).not.toThrow();
  });
});
