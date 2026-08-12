/**
 * A 4×6 shipping label, as one self-contained HTML page.
 *
 * WHY HTML AND NOT A PDF
 *
 * A PDF needs a library, and the smallest credible one is larger than the whole
 * of thela against a 3 MiB bundle ceiling and 10 ms of CPU per request. It also
 * needs somewhere to live, which means an R2 object, which means a bucket,
 * which means the payment method that ADR-0021 removed from the install path.
 *
 * The browser in front of the shopkeeper already renders pages and already
 * prints them. `@page { size: 100mm 150mm; margin: 0 }` puts the same output on
 * a thermal printer loaded with 4×6 stock and on A4 with a label stuck to it.
 * Nothing is stored, so nothing has to be cleaned up, and a label reprinted six
 * months later is regenerated from the order rather than fetched from a bucket
 * nobody has been paying for.
 *
 * WHAT GOES ON IT, AND WHY THAT AND NOT MORE
 *
 * A courier needs the destination, a scannable barcode, and enough of a return
 * address to send the parcel back. Everything else is the shopkeeper's own
 * convenience — the order number so they can find it again, and the item list
 * so they can check the box before sealing it. There is no branding: this is a
 * document for a depot, not a customer.
 */

import { barcodeSvg } from './code128';
import type { Address, LabelData } from './types';

export interface LabelOptions {
  /** Printed small under the barcode so a human can read what it encodes. */
  showHumanReadable?: boolean;
  /** Packing checklist. Absent for a carrier that requires a clean label. */
  contents?: { qty: number; title: string; options?: string }[];
}

export function renderLabel(data: LabelData, opts: LabelOptions = {}): string {
  const { showHumanReadable = true, contents = [] } = opts;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(data.tracking)} — ${esc(data.carrierName)}</title>
<style>
  /*
    100×150mm is the near-universal thermal label size, sold as "4×6" almost
    everywhere. margin:0 matters: a printer driver's default margin silently
    scales the barcode down and is the usual reason a label stops scanning.
  */
  @page { size: 100mm 150mm; margin: 0; }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    width: 100mm; height: 150mm;
    font: 3.2mm/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex; flex-direction: column;
    /* Nothing prints in the outer 3mm on most thermal heads. */
    padding: 3mm;
  }

  .rule { border-top: 0.4mm solid #000; margin: 1.6mm 0; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; }
  .tiny { font-size: 2.5mm; text-transform: uppercase; letter-spacing: .08em; }
  .carrier { font-size: 4.6mm; font-weight: 700; letter-spacing: -.01em; }
  .service { font-size: 3mm; }

  /*
    The destination is the only thing a sorter reads at speed, so it gets the
    most ink on the label and nothing competes with it.
  */
  .to-name { font-size: 4.6mm; font-weight: 700; }
  .to { font-size: 4mm; line-height: 1.3; }
  .to .postcode { font-size: 5.4mm; font-weight: 700; letter-spacing: .04em; }

  .from { font-size: 2.7mm; line-height: 1.25; }

  .barcode { margin-top: auto; }
  .hr { text-align: center; font-size: 3.4mm; letter-spacing: .22em;
        font-variant-numeric: tabular-nums; margin-top: 1mm; }

  .contents { font-size: 2.6mm; line-height: 1.3; }
  .contents li { list-style: none; }

  /* Routing marks are large because they are read by a person at a belt. */
  .marks { font-size: 6mm; font-weight: 700; letter-spacing: .02em; }

  @media screen {
    /* Only so it is legible while the shopkeeper checks it before printing. */
    body { box-shadow: 0 0 0 1px #ddd; margin: 4mm auto; }
  }
</style>
</head>
<body>

  <div class="row">
    <span class="carrier">${esc(data.carrierName)}</span>
    <span class="service">${esc(data.serviceType ?? '')}</span>
  </div>
  <div class="row tiny">
    <span>${esc(data.paymentMode)}</span>
    <span>${esc(data.orderId)}</span>
  </div>

  <div class="rule"></div>

  <div class="tiny">Deliver to</div>
  <div class="to">
    <div class="to-name">${esc(data.to.name)}</div>
    ${addressLines(data.to)}
    <div class="postcode">${esc(data.to.postcode)}</div>
    ${data.to.phone ? `<div>${esc(data.to.phone)}</div>` : ''}
  </div>

  ${data.sortCode || data.routingCode
    ? `<div class="rule"></div>
       <div class="row marks">
         <span>${esc(data.sortCode ?? '')}</span>
         <span>${esc(data.routingCode ?? '')}</span>
       </div>`
    : ''}

  <div class="rule"></div>

  <div class="tiny">Return to</div>
  <div class="from">
    <div><strong>${esc(data.from.name)}</strong></div>
    ${addressLines(data.from)}
    <div>${esc(data.from.postcode)}${data.from.phone ? ` · ${esc(data.from.phone)}` : ''}</div>
  </div>

  ${contents.length > 0
    ? `<div class="rule"></div>
       <div class="tiny">Contents</div>
       <ul class="contents" style="margin:.5mm 0 0;padding:0">
         ${contents
           .map((c) => `<li>${c.qty} × ${esc(c.title)}${c.options ? ` — ${esc(c.options)}` : ''}</li>`)
           .join('')}
       </ul>`
    : ''}

  <div class="barcode">
    <div class="rule"></div>
    <div class="row tiny" style="margin-bottom:1mm">
      <span>${esc(data.weightG)} g</span>
      ${data.amountMinor != null && data.paymentMode === 'COD'
        ? `<span>Collect ${esc(data.currency ?? '')} ${(data.amountMinor / 100).toFixed(2)}</span>`
        : '<span></span>'}
    </div>
    ${barcodeSvg(data.barcodeValue, { height: 18 })}
    ${showHumanReadable ? `<div class="hr">${esc(spaced(data.tracking))}</div>` : ''}
  </div>

  <script>
    /*
      Open the print dialog straight away. The shopkeeper clicked "Print label";
      making them then find the browser's own print command is a step that
      exists only because nobody removed it.

      Guarded on ?print=0 so the same URL can be opened to check a label
      without a dialog appearing over it.
    */
    if (!location.search.includes('print=0')) addEventListener('load', () => print());
  </script>
</body>
</html>`;
}

/**
 * Address lines, in an order that suits a sorter rather than a database.
 *
 * The postcode is rendered separately and larger by the caller, so it is
 * deliberately absent here.
 */
function addressLines(a: Address): string {
  return [a.line1, a.line2, [a.city, a.region].filter(Boolean).join(', '), a.country]
    .filter((l): l is string => Boolean(l && l.trim()))
    .map((l) => `<div>${esc(l)}</div>`)
    .join('');
}

/** Group a long tracking number so a human can read it back over a phone. */
const spaced = (s: string): string => s.replace(/(.{4})/g, '$1 ').trim();

/**
 * Escape for HTML.
 *
 * Every field on this label came from a customer's checkout form. A name
 * containing `<script>` must print as those characters, not run — and the label
 * route is the one page in thela that a shopkeeper opens without thinking.
 */
function esc(v: string | number): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
