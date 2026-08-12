/**
 * The shipping port.
 *
 * v0.1 ships two adapters: `delhivery` (direct carrier) and `manual` (the
 * shopkeeper books the parcel themselves and pastes the AWB). An aggregator
 * adapter can be added later against this same interface.
 *
 * Two details in here are not decoration:
 *
 *  - `estimatedOnly` on a quote, because Delhivery's own invoice API states
 *    that "actual amount charged by delhivery can be different from what is
 *    calculated by this API", and throttles at 40 req/min. Never quote a live
 *    checkout from it; serve a cached zone x weight table and reconcile later.
 *
 *  - `Label` is a discriminated union, because carriers disagree about what a
 *    label even is. Delhivery's packing-slip endpoint returns JSON that you
 *    must render (Code128 barcode, 4x6in / 100x150mm layout) yourself, while
 *    aggregators hand back a hosted PDF URL.
 */

export type Minor = number;

export interface Address {
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
}

export interface Parcel {
  weightG: number;
  lenMm: number;
  widMm: number;
  hgtMm: number;
  declaredValueMinor: Minor;
}

/**
 * Indian couriers bill on max(dead weight, volumetric), where volumetric is
 * L*W*H in cm divided by 5000, rounded up to the next 0.5 kg slab. Framed art,
 * cushions, lampshades — anything light and bulky — is priced on its box, not
 * its mass. Shops that quote from dead weight undercharge on every large item.
 */
export function billableWeightG(p: Parcel, divisor = 5000): number {
  const volumetricG =
    ((p.lenMm / 10) * (p.widMm / 10) * (p.hgtMm / 10) / divisor) * 1000;
  const greater = Math.max(p.weightG, volumetricG);
  return Math.ceil(greater / 500) * 500;
}

export interface Serviceability {
  serviceable: boolean;
  prepaid: boolean;
  cod: boolean;
}

export interface Quote {
  amountMinor: Minor;
  gstIncluded: boolean;
  /** True when the carrier disclaims the figure. Do not bill against it. */
  estimatedOnly: boolean;
  billableWeightG: number;
}

export type Label =
  | { type: 'url'; href: string }
  | { type: 'render'; data: LabelData };

/** Everything needed to draw a 4x6in shipping label ourselves. */
export interface LabelData {
  awb: string;
  barcodeValue: string;
  carrierName: string;
  serviceType?: string;
  from: Address;
  to: Address;
  orderId: string;
  weightG: number;
  paymentMode: 'Prepaid' | 'COD';
  amountMinor?: Minor;
  sortCode?: string;
  routingCode?: string;
}

export interface Shipment {
  awb: string;
  carrier: string;
  label: Label;
  raw?: unknown;
}

export type ShipmentStatus =
  | 'created'
  | 'pickup_scheduled'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'undelivered'
  | 'rto'
  | 'cancelled'
  | 'unknown';

export interface TrackingUpdate {
  status: ShipmentStatus;
  raw: string;
  at: string;
  location?: string;
}

export interface ShippingAdapter {
  readonly id: string;

  /** Whether this adapter dispatches without a human. `manual` returns false. */
  readonly automatic: boolean;

  serviceability(pincode: string): Promise<Serviceability>;

  quote(input: {
    originPincode: string;
    destPincode: string;
    parcel: Parcel;
  }): Promise<Quote>;

  createShipment(input: {
    orderId: string;
    from: Address;
    to: Address;
    parcel: Parcel;
  }): Promise<Shipment>;

  track(awb: string): Promise<TrackingUpdate[]>;

  cancel(awb: string): Promise<void>;

  schedulePickup(awbs: string[]): Promise<void>;

  /**
   * Prepaid wallet balance, where the carrier uses one.
   *
   * This matters more than it looks. Delhivery and every Indian aggregator
   * debit freight from a prepaid wallet at manifest time. An empty wallet
   * means the customer's payment succeeded and the parcel silently never
   * ships — the worst failure the system can have. A cron watches this and
   * alarms the shopkeeper long before it hits zero.
   */
  walletBalance?(): Promise<Minor>;
}
