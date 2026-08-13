/**
 * Evidence source: a bank statement the merchant uploads.
 *
 * Slower than email — settlement waits for the upload — but STRONGER, because
 * a statement is the account's own ledger rather than a notification about an
 * attempt. This is the correct primary source for any bank whose alert email
 * is absent, thresholded, or (see RBL) untrustworthy.
 *
 * Deliberately CSV-only. Bank PDFs are a parsing swamp and every Indian bank
 * offers CSV or Excel export; asking for the CSV is a one-line instruction and
 * saves a large dependency that would not fit a Worker bundle anyway.
 */

import { parseMoney } from '../../money';
import { resolve } from '../resolve';
import type { Resolution } from '../types';

/** Header names seen across Indian bank exports, lowercased and stripped. */
const COLUMNS = {
  credit: ['creditamount', 'credit', 'depositamt', 'deposit', 'cr', 'creditinr'],
  date: ['transactiondate', 'txndate', 'date', 'valuedate', 'postingdate'],
  ref: ['chequenumber', 'refnumber', 'referencenumber', 'utr', 'transactionid', 'chqrefnumber'],
  narration: ['narration', 'description', 'particulars', 'remarks', 'transactionremarks'],
} as const;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

export interface StatementRow {
  amountMinor: number;
  reference: string;
  at: string;
  narration?: string;
}

/**
 * Parse a statement export into candidate credits.
 *
 * Only credits are returned; debits are the merchant's own spending and have
 * no bearing on whether a customer paid.
 */
export function parseStatement(csv: string): StatementRow[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];

  const header = (rows[0] ?? []).map(norm);
  const at = (names: readonly string[]) =>
    header.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));

  const iCredit = at(COLUMNS.credit);
  const iDate = at(COLUMNS.date);
  const iRef = at(COLUMNS.ref);
  const iNarr = at(COLUMNS.narration);
  if (iCredit < 0 || iDate < 0) return [];

  const out: StatementRow[] = [];
  for (const row of rows.slice(1)) {
    const amountMinor = parseMoney(row[iCredit] ?? '');
    if (!amountMinor) continue; // blank credit column means it was a debit

    const narration = iNarr >= 0 ? row[iNarr] : undefined;
    // Prefer an explicit reference column; otherwise recover the 12-digit UPI
    // RRN that banks embed in the narration (e.g. "UPI/402312345678/...").
    const reference =
      (iRef >= 0 ? row[iRef]?.trim() : '') ||
      narration?.match(/\b(\d{12})\b/)?.[1] ||
      '';
    if (!reference) continue; // unreferenced credit: nothing to be idempotent on

    const at = parseDate(row[iDate]);
    if (!at) continue;

    out.push({ amountMinor, reference, at, narration });
  }
  return out;
}

export async function importStatement(
  db: D1Database,
  csv: string,
  meta: {
    importId: string;
    filename: string;
    /**
     * The account's currency. A statement states amounts and not what they are
     * denominated in, because the account only ever holds one currency — so it
     * has to be supplied, and it must be the shop's own.
     */
    currency: string;
    bankId?: string;
    actor?: string;
  },
): Promise<{ rows: number; results: Resolution[] }> {
  const rows = parseStatement(csv);
  const results: Resolution[] = [];

  for (const r of rows) {
    results.push(
      await resolve(db, {
        source: 'statement',
        confidence: 'ledger',
        reference: r.reference,
        amountMinor: r.amountMinor,
        currency: meta.currency,
        at: r.at,
        // A statement gives a date, not a time. Saying so is what stops the
        // window rejecting every genuine row.
        timePrecision: 'day',
        narration: r.narration,
        bankId: meta.bankId,
      }),
    );
  }

  const dates = rows.map((r) => r.at).sort();
  await db
    .prepare(
      `INSERT INTO statement_import
         (id, bank_id, filename, row_count, matched, uploaded_by, period_from, period_to)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      meta.importId,
      meta.bankId ?? null,
      meta.filename,
      rows.length,
      results.filter((r) => r.outcome === 'settled').length,
      meta.actor ?? null,
      dates[0] ?? null,
      dates[dates.length - 1] ?? null,
    )
    .run();

  return { rows: rows.length, results };
}

/** Minimal RFC 4180 reader: quoted fields, escaped quotes, CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Statements are day-first almost everywhere except the US (28/07/2026,
 * 28-07-2026, 28 Jul 2026), so that is the default reading. Pass
 * `dayFirst: false` for a US statement.
 *
 * Getting this wrong is survivable but not free: the minor-unit slot is what
 * actually identifies the order, and the date only bounds the match window, so
 * a swapped day and month shifts a transaction by days rather than mismatching
 * it. Rows outside the window land in review, never on the wrong order.
 *
 * Statements frequently carry no time at all, hence midnight UTC.
 */
function parseDate(raw?: string, dayFirst = true): string | null {
  if (!raw) return null;
  const s = raw.trim();

  const numeric = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (numeric) {
    const [, first = '', second = '', rawYear = ''] = numeric;
    const day = dayFirst ? first : second;
    const month = dayFirst ? second : first;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`;
  }

  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}
