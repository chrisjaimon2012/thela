/**
 * Code 128, as an SVG path.
 *
 * Every courier in the world scans Code 128 off a shipping label, so producing
 * one is the difference between a label a driver accepts and a piece of paper.
 *
 * WHY WE DRAW IT OURSELVES
 *
 * The alternatives are a PDF library and a barcode package, and both are the
 * wrong shape for this. A Worker has ~10 ms of CPU on the free plan and a
 * 3 MiB bundle ceiling; `pdf-lib` alone is larger than the entire rest of thela.
 * The label is one page of HTML with `@page { size: 100mm 150mm }`, printed by
 * the browser the shopkeeper already has open. No PDF, no R2 object, no
 * storage, nothing to clean up, and it prints identically to a thermal printer
 * and to A4 with a 4×6 label stuck on it.
 *
 * The encoding is a published specification (ISO/IEC 15417) and the pattern
 * table below is the standard one — arithmetic, not anyone's design.
 */

/**
 * The 107 symbol patterns, as bar/space widths.
 *
 * Each string is six digits: bar, space, bar, space, bar, space, in modules.
 * Index is the code value; 103–106 are Start A, Start B, Start C and Stop.
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '233111',
] as const;

const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

/** Quiet zone either side. The spec requires at least 10 modules; scanners want it. */
const QUIET = 10;

/**
 * Encode to code values, switching between subsets B and C.
 *
 * Subset C packs two digits into one symbol, which roughly halves the width of
 * a long numeric tracking number. That matters on a 100 mm label: a 20-digit
 * USPS number in subset B alone is wider than the paper.
 *
 * The rule is the conventional one — switch to C for a run of four or more
 * digits (six at the start, where the start character itself is the switch),
 * and only for an even number of them, since C consumes digits in pairs.
 */
export function encode(text: string): number[] {
  if (!/^[\x20-\x7e]*$/.test(text)) {
    throw new Error('Code 128 here supports printable ASCII only; got other characters.');
  }

  const digitsAt = (i: number): number => {
    let n = 0;
    while (i + n < text.length && text[i + n]! >= '0' && text[i + n]! <= '9') n++;
    return n;
  };

  const values: number[] = [];
  let inC = false;
  let i = 0;

  // Starting in C pays for itself only from six digits, because otherwise the
  // switch back costs more than the packing saves.
  const startDigits = digitsAt(0);
  if (startDigits >= 6 || (startDigits >= 2 && startDigits === text.length)) {
    values.push(START_C);
    inC = true;
  } else {
    values.push(START_B);
  }

  while (i < text.length) {
    const run = digitsAt(i);

    if (inC) {
      if (run >= 2) {
        // Consume pairs. An odd digit left at the end falls back to B below.
        const pairs = Math.floor((run - (run % 2 === 1 && i + run === text.length ? 1 : 0)) / 2);
        for (let p = 0; p < pairs; p++) {
          values.push(Number(text.slice(i, i + 2)));
          i += 2;
        }
        continue;
      }
      values.push(CODE_B);
      inC = false;
      continue;
    }

    // In B. Switch to C when a long enough even run appears.
    const evenRun = run % 2 === 0 ? run : run - 1;
    if (evenRun >= 4 && (i + run === text.length ? run >= 2 : true)) {
      values.push(CODE_C);
      inC = true;
      continue;
    }

    values.push(text.charCodeAt(i) - 32);
    i++;
  }

  // Modulo-103 weighted checksum: start value, then position × value.
  let sum = values[0]!;
  for (let k = 1; k < values.length; k++) sum += k * values[k]!;
  values.push(sum % 103);

  values.push(STOP);
  return values;
}

export interface Barcode {
  /** SVG path data, one filled rectangle per bar. */
  path: string;
  /** Total width in modules, including quiet zones. Use as the viewBox width. */
  modules: number;
}

/**
 * Render to a single SVG path.
 *
 * One `<path>` rather than dozens of `<rect>`s: it is a third of the bytes and
 * renders identically. The caller supplies height and scales with a viewBox, so
 * the same output prints at 100 mm or at 4 inches without re-encoding.
 */
export function barcode(text: string): Barcode {
  const values = encode(text);

  let x = QUIET;
  const parts: string[] = [];

  for (const value of values) {
    const pattern = PATTERNS[value];
    if (!pattern) throw new Error(`Code 128: no pattern for value ${value}`);

    for (let k = 0; k < pattern.length; k++) {
      const width = Number(pattern[k]);
      // Even indices are bars, odd are spaces. Only bars are drawn.
      if (k % 2 === 0) parts.push(`M${x} 0h${width}v1h-${width}z`);
      x += width;
    }
  }

  // Stop pattern carries a final 2-module bar the table does not include.
  parts.push(`M${x} 0h2v1h-2z`);
  x += 2;

  return { path: parts.join(''), modules: x + QUIET };
}

/** A complete `<svg>` element, sized by the caller's CSS. */
export function barcodeSvg(text: string, opts: { height?: number } = {}): string {
  const { path, modules } = barcode(text);
  const height = opts.height ?? 1;
  return (
    `<svg viewBox="0 0 ${modules} 1" preserveAspectRatio="none" ` +
    `style="width:100%;height:${height}mm;display:block" ` +
    `shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${path}" fill="#000"/></svg>`
  );
}
