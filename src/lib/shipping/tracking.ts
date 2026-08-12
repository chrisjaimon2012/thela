/**
 * Recognising a tracking number, and turning it into a link.
 *
 * This is what makes the `manual` carrier honest rather than a placeholder.
 * The shopkeeper books the parcel however they already do — a counter, a
 * courier's own app, a phone call — pastes the number, and thela works out who
 * carries it, checks the number is not a typo, and emails the customer a link
 * that goes to the right tracking page.
 *
 * That covers every country on the day a shop installs, with no carrier
 * account, no contract, no API key and no adapter. The S10 entry alone reaches
 * 191 national postal operators, because it is the Universal Postal Union's
 * own standard: `EE123456789IN` is India Post and `CP123456789FR` is La Poste,
 * from one pattern.
 *
 * WHY THE CHECK DIGIT MATTERS MORE THAN IT SOUNDS
 *
 * A mistyped tracking number is not a cosmetic error. It goes out in a
 * dispatch email, the customer clicks it, sees "not found", and now believes
 * their parcel is lost. Catching it while the shopkeeper is still looking at
 * the form costs nothing; catching it afterwards costs a support conversation
 * and some trust.
 *
 * Data is vendored from jkeen/tracking_number_data (MIT) and compiled by
 * `scripts/build-tracking-data.mjs`. See vendor/tracking-number-data/PINNED.md.
 */

import { PATTERNS, S10_COURIERS, type Checksum, type PrependIf, type TrackingPattern } from './tracking-data.generated';

export interface Detected {
  /** The number as it should be stored: whitespace and separators removed. */
  normalised: string;
  /** "India Post", "UPS", "La Poste". */
  courier: string;
  courierCode: string;
  /** Which pattern matched, for diagnosing a wrong guess. */
  patternId: string;
  /** True when the check digit is right. False means almost certainly a typo. */
  valid: boolean;
  /** Ready to send to a customer, when the carrier publishes a tracking page. */
  url: string | null;
}

/**
 * Compiled patterns, built once per isolate.
 *
 * Anchored at both ends: an unanchored match would let a long string of digits
 * satisfy a short pattern hidden somewhere inside it, which is how a UPS number
 * gets misread as something else entirely.
 */
const COMPILED: { pattern: TrackingPattern; re: RegExp }[] = PATTERNS.map((pattern) => ({
  pattern,
  re: new RegExp(`^${pattern.source}$`, 'i'),
}));

/**
 * Strip the whitespace a label prints between characters, and nothing else.
 *
 * NOT hyphens. LaserShip's 18-character pattern ends in a literal `-1`, so a
 * hyphen can be part of the number rather than decoration, and removing it
 * makes their real numbers unrecognisable. `detect` retries without hyphens
 * only when the faithful form matches nothing, which keeps both cases working
 * without letting the convenience break the correctness.
 */
export const normalise = (raw: string): string => raw.replace(/\s/g, '').toUpperCase();

/**
 * Identify a tracking number.
 *
 * Returns every pattern that matched, best first — "best" meaning a valid
 * check digit beats an invalid one. Several patterns can legitimately match one
 * number, and the check digit is what tells them apart, so returning a list
 * rather than a guess lets the admin show the ambiguity when there is any.
 */
export function detect(raw: string): Detected[] {
  const faithful = normalise(raw);
  if (!faithful) return [];

  const matches = match(faithful);
  if (matches.length > 0) return matches;

  // Nothing recognised it as typed. A human pasting a UPS number with hyphens
  // is common enough to be worth a second attempt, and by now we know we are
  // not discarding a hyphen that some carrier's pattern needed.
  const dehyphenated = faithful.replace(/-/g, '');
  return dehyphenated === faithful ? [] : match(dehyphenated);
}

function match(normalised: string): Detected[] {
  const found: Detected[] = [];

  for (const { pattern, re } of COMPILED) {
    const m = re.exec(normalised);
    if (!m) continue;

    const groups = m.groups ?? {};
    const serial = clean(groups.SerialNumber ?? '');
    const checkDigit = clean(groups.CheckDigit ?? '');
    const countryCode = clean(groups.CountryCode ?? '');

    // S10's country code names the operator; everything else is the file's own.
    const courier =
      pattern.courierCode === 's10'
        ? (S10_COURIERS[countryCode] ?? `${countryCode} national post`)
        : pattern.courier;

    // An S10 number whose country code is not a UPU member is not an S10
    // number, whatever the shape says.
    if (pattern.courierCode === 's10' && !S10_COURIERS[countryCode]) continue;

    found.push({
      normalised,
      courier,
      courierCode: pattern.courierCode,
      patternId: pattern.id,
      valid: pattern.checksum
        ? verify(pattern.checksum, prepend(serial, pattern.prependIf), checkDigit)
        : true,
      url: pattern.url ? pattern.url.replace('%s', encodeURIComponent(normalised)) : null,
    });
  }

  return found.sort((a, b) => Number(b.valid) - Number(a.valid));
}

/** The single best guess, or null when nothing recognised it. */
export const identify = (raw: string): Detected | null => detect(raw)[0] ?? null;

/**
 * Build a tracking URL from a template.
 *
 * The template is editable in the admin, which is the whole reason any carrier
 * on earth works without code: a shopkeeper using a courier nobody has heard of
 * pastes `https://their-courier.example/track?id=:tracking` once and every
 * dispatch email is correct from then on. Borrowed from Spree, which has been
 * doing exactly this for years.
 */
export function trackingUrl(template: string, tracking: string): string | null {
  if (!template.includes(':tracking')) return null;
  return template.replace(':tracking', encodeURIComponent(normalise(tracking)));
}

// ---------------------------------------------------------------------------
// Check digits
//
// Six algorithms, transcribed from the carriers' own published specifications
// as documented in the vendored dataset. Ported rather than adapted: these are
// arithmetic facts, not anyone's creative expression.
// ---------------------------------------------------------------------------

/**
 * Re-attach an implied prefix before checksumming.
 *
 * USPS 91, FedEx SmartPost and OnTrac all print a number shorter than the one
 * their check digit was computed over. Skipping this does not throw — it
 * quietly reports every genuine number from those carriers as a typo.
 */
function prepend(serial: string, rule: PrependIf | null): string {
  if (!rule) return serial;
  return new RegExp(rule.unless).test(serial) ? rule.content + serial : serial;
}

function verify(cs: Checksum, serial: string, checkDigit: string): boolean {
  if (!serial || !checkDigit) return false;

  switch (cs.name) {
    case 'mod10':
      return mod10(serial, checkDigit, cs.evens, cs.odds, cs.reverse);
    case 'mod7':
      return mod7(serial, checkDigit);
    case 's10':
      return s10(serial, checkDigit);
    case 'luhn':
      return luhn(serial, checkDigit);
    case 'mod_37_36':
      return mod3736(serial, checkDigit);
    case 'sum_product_with_weightings_and_modulo':
      return sumProduct(serial, checkDigit, cs.weightings ?? [], cs.modulo1, cs.modulo2);
    default:
      // An unknown algorithm must not silently pass a number as valid. The
      // build would have to add it deliberately.
      return false;
  }
}

/** Letters count as (charCode - 3) mod 10, which is the carriers' convention. */
const digitValue = (c: string): number =>
  /[0-9]/.test(c) ? Number(c) : (c.charCodeAt(0) - 3) % 10;

function mod10(
  serial: string,
  checkDigit: string,
  evens: number | null,
  odds: number | null,
  reverse: boolean,
): boolean {
  // Which end the multipliers are counted from is part of the carrier's spec,
  // not an implementation detail: DHL E-Commerce and USPS 22 weight from the
  // right, everyone else from the left.
  const chars = reverse ? [...serial].reverse() : [...serial];

  let total = 0;
  for (let i = 0; i < chars.length; i++) {
    let x = digitValue(chars[i]!);
    if (odds !== null && i % 2 === 1) x *= odds;
    else if (evens !== null && i % 2 === 0) x *= evens;
    total += x;
  }
  const rem = total % 10;
  return (rem === 0 ? 0 : 10 - rem) === Number(checkDigit);
}

const mod7 = (serial: string, checkDigit: string): boolean =>
  Number(serial) % 7 === Number(checkDigit);

/** UPU S10: fixed weights, then the two special remainders. */
function s10(serial: string, checkDigit: string): boolean {
  const weights = [8, 6, 4, 2, 3, 5, 9, 7];
  let total = 0;
  for (let i = 0; i < weights.length && i < serial.length; i++) {
    total += Number(serial[i]) * weights[i]!;
  }
  const rem = total % 11;
  const check = rem === 1 ? 0 : rem === 0 ? 5 : 11 - rem;
  return check === Number(checkDigit);
}

function luhn(serial: string, checkDigit: string): boolean {
  let total = 0;
  // Weight from the right, which is what makes it Luhn rather than mod10.
  const chars = [...serial].reverse();
  for (let i = 0; i < chars.length; i++) {
    let x = Number(chars[i]);
    if (i % 2 === 0) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    total += x;
  }
  const rem = total % 10;
  return (rem === 0 ? 0 : 10 - rem) === Number(checkDigit);
}

/** DPD's parcel-label specification 2.4.1, section on the check character. */
function mod3736(serial: string, checkDigit: string): boolean {
  const mod = 36;
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const weight = (c: string): number =>
    /[0-9]/.test(c) ? Number(c) : letters.indexOf(c.toUpperCase()) + 10;

  let cd = mod;
  for (const c of serial) {
    cd = weight(c) + cd;
    if (cd > mod) cd -= mod;
    cd *= 2;
    if (cd > mod) cd -= mod + 1;
  }
  cd = mod + 1 - cd;
  if (cd === mod) cd = 0;

  const computed = cd >= 10 ? letters[cd - 10]! : String(cd);
  return computed === checkDigit.toUpperCase();
}

/** FedEx: weighted sum, then two moduli in sequence. */
function sumProduct(
  serial: string,
  checkDigit: string,
  weightings: number[],
  modulo1: number | null,
  modulo2: number | null,
): boolean {
  if (!modulo1 || !modulo2) return false;
  let total = 0;
  for (let i = 0; i < weightings.length && i < serial.length; i++) {
    total += Number(serial[i]) * weightings[i]!;
  }
  return ((total % modulo1) % modulo2) === Number(checkDigit);
}

const clean = (s: string): string => s.replace(/\s/g, '');
