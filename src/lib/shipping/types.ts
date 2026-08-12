/**
 * The shipping port.
 *
 * One interface, many carriers, no aggregator anywhere in the default path
 * (ADR-0023). A carrier adapter is a file: it holds no state, stores no
 * credentials of its own, and can be contributed without touching core.
 *
 * WHAT DECIDES WHETHER AN ADAPTER LIVES IN CORE
 *
 * Only whether a maintainer can hold a live account with that carrier and CI
 * can exercise it. That is not fussiness — Colissimo issues no test accounts
 * at all, so nobody without a French commercial contract can write, test or
 * fix that adapter, however good this interface is. Adapters therefore declare
 * their own `support` level and the admin shows it, so a shopkeeper knows
 * whether the thing dispatching their parcels is watched or merely present.
 *
 * WHY `manual` IS NOT A STOPGAP
 *
 * It is the floor. A shop in a country nobody has written an adapter for still
 * sells, still prints a label, and still emails a working tracking link on the
 * day it installs thela. Everything else is upside.
 *
 * THREE DETAILS THAT LOOK LIKE DECORATION AND ARE NOT
 *
 *  - `estimatedOnly` on a rate, because Delhivery's own invoice API states
 *    that "actual amount charged by delhivery can be different from what is
 *    calculated by this API", and throttles at 40 req/min. Never quote a live
 *    checkout from it; serve a cached zone × weight table and reconcile later.
 *
 *  - `Label` is a discriminated union, because carriers disagree about what a
 *    label even is. Delhivery's packing-slip endpoint returns JSON you must
 *    draw yourself; others hand back a hosted PDF URL; some return raw ZPL for
 *    a thermal printer. Label bytes are opaque — never parse or rewrite them.
 *
 *  - `rateId` is opaque and round-trips from `rates()` to `createShipment()`.
 *    Carriers that price by service code and carriers that price by quote token
 *    both fit; without it, rate shopping cannot be expressed at all.
 */

export type Minor = number;

/**
 * A postal address anywhere.
 *
 * `postcode` and `country` are the only geographic requirements, which is what
 * the schema's own CHECK enforces. `region` is optional because a French
 * address has no state and an Irish one has no postcode in the usual sense —
 * an adapter that needs a region says so in `requires`.
 */
export interface Address {
  name: string;
  phone: string;
  email?: string;
  line1: string;
  line2?: string;
  city: string;
  /** State, province, département, prefecture. Absent in much of the world. */
  region?: string;
  postcode: string;
  /** ISO 3166-1 alpha-2. Load-bearing: it selects the adapter's rules. */
  country: string;
}

export interface Parcel {
  weightG: number;
  lenMm: number;
  widMm: number;
  hgtMm: number;
  declaredValueMinor: Minor;
}

/**
 * Couriers bill on max(dead weight, volumetric). Framed art, cushions,
 * lampshades — anything light and bulky — is priced on its box, not its mass.
 * A shop quoting from dead weight undercharges on every large item.
 *
 * Both parameters vary by carrier and by lane, which is why they are arguments
 * rather than constants: 5000 is the common Indian domestic divisor, 4000 is
 * usual for European road freight, and IATA air uses 6000. Rounding differs
 * too — Indian carriers slab to the next 500 g, many European ones to 1 kg.
 */
export function billableWeightG(p: Parcel, divisor = 5000, slabG = 500): number {
  const volumetricG =
    (((p.lenMm / 10) * (p.widMm / 10) * (p.hgtMm / 10)) / divisor) * 1000;
  const greater = Math.max(p.weightG, volumetricG);
  return Math.ceil(greater / slabG) * slabG;
}

export interface Serviceability {
  serviceable: boolean;
  prepaid: boolean;
  cod: boolean;
  /** Carrier's own words, for the admin to show when it says no. */
  note?: string;
}

/**
 * One priced option. `rates()` returns several so the shopkeeper — or a rule —
 * can choose between "cheapest" and "arrives Thursday".
 */
export interface Rate {
  /** Opaque to core. Hand it back to `createShipment` unchanged. */
  rateId: string;
  carrier: string;
  /** The carrier's own service name, shown to the shopkeeper verbatim. */
  service: string;
  amountMinor: Minor;
  currency: string;
  taxIncluded: boolean;
  /** True when the carrier disclaims the figure. Do not bill against it. */
  estimatedOnly: boolean;
  billableWeightG: number;
  transitDaysMin?: number;
  transitDaysMax?: number;
}

export type Label =
  | { type: 'url'; href: string }
  | { type: 'bytes'; contentType: string; body: ArrayBuffer }
  | { type: 'render'; data: LabelData };

/** Everything needed to draw a 4×6in label ourselves, for carriers that return data. */
export interface LabelData {
  tracking: string;
  barcodeValue: string;
  carrierName: string;
  serviceType?: string;
  from: Address;
  to: Address;
  orderId: string;
  weightG: number;
  paymentMode: 'Prepaid' | 'COD';
  amountMinor?: Minor;
  currency?: string;
  /** Carrier-specific routing marks, printed verbatim where present. */
  sortCode?: string;
  routingCode?: string;
}

export interface Shipment {
  tracking: string;
  carrier: string;
  label?: Label;
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
  | 'returned'
  | 'cancelled'
  | 'unknown';

export interface TrackingUpdate {
  status: ShipmentStatus;
  /** The carrier's own wording, kept so a wrong mapping is diagnosable. */
  raw: string;
  at: string;
  location?: string;
}

/**
 * How closely core watches this adapter.
 *
 * Shown in the admin next to the carrier's name. A shopkeeper choosing how
 * their parcels get dispatched deserves to know whether anyone is minding it.
 */
export type SupportLevel =
  /** A maintainer holds a live account and CI exercises it against cassettes. */
  | 'core'
  /** Contributed and reviewed, but nobody in core can test it. Breakage is found by users. */
  | 'community'
  /** Known incomplete or unverified against the live API. */
  | 'experimental';

/** What an adapter can actually do. Core never assumes; the admin renders from this. */
export interface Capabilities {
  rates: boolean;
  createShipment: boolean;
  label: boolean;
  track: boolean;
  cancel: boolean;
  pickup: boolean;
  serviceability: boolean;
}

export interface CarrierAdapter {
  readonly id: string;
  /** Shown to shopkeepers. "Delhivery", "Colissimo", "Book it yourself". */
  readonly name: string;
  readonly support: SupportLevel;
  readonly capabilities: Capabilities;

  /** ISO 3166-1 alpha-2 origin countries. Empty means anywhere. */
  readonly countries: readonly string[];

  /**
   * Credential fields this adapter needs, for the admin to render a form and
   * for the setup wizard to know whether it can be selected at all.
   */
  readonly requires: readonly CredentialField[];

  /**
   * ISO date a maintainer last ran this against the live API. Rendered in the
   * admin, because "community, last verified 14 months ago" is information a
   * shopkeeper can act on and "community" alone is not.
   */
  readonly lastVerifiedLive?: string;

  serviceability?(to: Address): Promise<Serviceability>;

  rates?(input: {
    from: Address;
    to: Address;
    parcel: Parcel;
  }): Promise<Rate[]>;

  createShipment(input: {
    orderId: string;
    from: Address;
    to: Address;
    parcel: Parcel;
    /** From a prior `rates()` call. Absent when the adapter has no rating. */
    rateId?: string;
  }): Promise<Shipment>;

  track?(tracking: string): Promise<TrackingUpdate[]>;

  cancel?(tracking: string): Promise<void>;

  schedulePickup?(trackings: string[]): Promise<void>;

  /**
   * Prepaid wallet balance, where the carrier uses one.
   *
   * This matters more than it looks. Delhivery and most Indian carriers debit
   * freight from a prepaid wallet at manifest time. An empty wallet means the
   * customer's payment succeeded and the parcel silently never ships — the
   * worst failure the system can have. A cron watches this and alarms the
   * shopkeeper long before it reaches zero.
   */
  walletBalance?(): Promise<Minor>;
}

export interface CredentialField {
  key: string;
  label: string;
  /** Stored as a Worker secret rather than in the settings table. */
  secret: boolean;
  help?: string;
}
