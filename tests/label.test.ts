import { describe, expect, it } from 'vitest';
import { renderLabel } from '../src/lib/shipping/label';
import type { Address, LabelData } from '../src/lib/shipping/types';

/**
 * The label is the one page a shopkeeper opens without reading it, and every
 * field on it came from a stranger's checkout form.
 */

const from: Address = {
  name: 'Cheerfully Given', phone: '+91 90000 00000',
  line1: 'St Andrews Church', line2: 'Camp', city: 'Pune',
  region: 'Maharashtra', postcode: '411001', country: 'IN',
};

const to: Address = {
  name: 'A Customer', phone: '+91 90000 11111',
  line1: '12 Example Road', city: 'Nashik',
  region: 'Maharashtra', postcode: '422001', country: 'IN',
};

const base: LabelData = {
  tracking: 'RB123456785IN',
  barcodeValue: 'RB123456785IN',
  carrierName: 'India Post',
  serviceType: 'Registered',
  from, to,
  orderId: 'ORD-1042',
  weightG: 900,
  paymentMode: 'Prepaid',
};

describe('renderLabel', () => {
  it('puts everything a courier needs on the page', () => {
    const html = renderLabel(base);
    expect(html).toContain('A Customer');
    expect(html).toContain('12 Example Road');
    expect(html).toContain('422001');
    expect(html).toContain('India Post');
    expect(html).toContain('ORD-1042');
    // Return address, or an undeliverable parcel has nowhere to go.
    expect(html).toContain('Cheerfully Given');
    expect(html).toContain('411001');
  });

  it('sizes the page for 4×6 thermal stock with no printer margin', () => {
    const html = renderLabel(base);
    expect(html).toContain('size: 100mm 150mm');
    // A driver's default margin scales the barcode down, and that is the usual
    // reason a label that looks fine stops scanning at a depot.
    expect(html).toContain('margin: 0;');
  });

  it('embeds the barcode rather than linking it', () => {
    const html = renderLabel(base);
    expect(html).toContain('<svg');
    expect(html).not.toContain('<img');
    // A label prints at a shop counter that may have no working internet.
    expect(html.replace(/xmlns="[^"]*"/g, '')).not.toMatch(/https?:\/\//);
  });

  it('shows the number in readable groups underneath', () => {
    // So a shopkeeper can read it back over a phone without losing their place.
    expect(renderLabel(base)).toContain('RB12 3456 785I N');
  });

  describe('escaping, because every field is a stranger’s input', () => {
    const hostile = '<script>alert(1)</script>';

    it('never lets a customer name execute', () => {
      const html = renderLabel({ ...base, to: { ...to, name: hostile } });
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes every free-text field, not just the obvious one', () => {
      const html = renderLabel({
        ...base,
        carrierName: hostile,
        serviceType: hostile,
        orderId: hostile,
        tracking: 'RB123456785IN',
        from: { ...from, name: hostile, line1: hostile },
        to: { ...to, line1: hostile, city: hostile, region: hostile },
      });
      // One script tag survives: the print trigger this page ships with.
      expect(html.match(/<script/g) ?? []).toHaveLength(1);
      expect(html).not.toContain('alert(1)</script>');
    });

    it('escapes quotes, so a name cannot break out of an attribute', () => {
      const html = renderLabel({ ...base, carrierName: 'A" onload="x' });
      expect(html).toContain('&quot;');
      expect(html).not.toContain('onload="x');
    });
  });

  describe('what is conditional', () => {
    it('omits routing marks when the carrier gave none', () => {
      expect(renderLabel(base)).not.toContain('class="marks"');
      const withMarks = renderLabel({ ...base, sortCode: 'NSK/PNQ', routingCode: 'W2' });
      expect(withMarks).toContain('NSK/PNQ');
      expect(withMarks).toContain('W2');
    });

    it('shows an amount to collect only for COD', () => {
      expect(renderLabel({ ...base, amountMinor: 139900 })).not.toContain('Collect');
      const cod = renderLabel({ ...base, paymentMode: 'COD', amountMinor: 139900, currency: 'INR' });
      expect(cod).toContain('Collect INR 1399.00');
    });

    it('lists contents only when asked, since some carriers want a clean label', () => {
      expect(renderLabel(base)).not.toContain('Contents');
      const packed = renderLabel(base, {
        contents: [{ qty: 2, title: 'Psalm 23', options: '12x18 in · Oak' }],
      });
      expect(packed).toContain('2 × Psalm 23');
      expect(packed).toContain('12x18 in · Oak');
    });

    it('drops empty address lines instead of printing blank rows', () => {
      const sparse = renderLabel({
        ...base,
        to: { name: 'B', phone: '', line1: '1 Rue', city: 'Lyon', postcode: '69001', country: 'FR' },
      });
      // A French address has no region; the label must not leave a gap for it.
      expect(sparse).not.toMatch(/<div><\/div>/);
      expect(sparse).toContain('Lyon');
      expect(sparse).toContain('69001');
    });
  });

  it('can be opened without the print dialog firing, for a quick check', () => {
    expect(renderLabel(base)).toContain("print=0");
  });
});
