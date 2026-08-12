/**
 * The `manual` carrier. The default, and the floor nothing falls below.
 *
 * The shopkeeper books the parcel however they already do — a courier's
 * counter, their own app, a phone call — and pastes the tracking number back
 * into thela. That is not a degraded mode; for most of the world it is simply
 * how parcels are booked, and it is what the church volunteer and the Lyon
 * studio are both doing today with no software at all.
 *
 * What thela adds on top of that is everything the shopkeeper was doing by
 * hand: the address is already typed, the label prints on the right paper, the
 * carrier is identified from the number, a typo is caught before it reaches a
 * customer, and the dispatch email goes out with a link that works.
 *
 * WHY THIS IS THE DEFAULT AND NOT A FALLBACK
 *
 * An adapter can only live in core if a maintainer holds a live account and CI
 * can exercise it (ADR-0023). Colissimo issues no test accounts at all, so
 * there are countries where no adapter can responsibly exist however much
 * effort is spent. `manual` means no shop is ever blocked waiting for one. A
 * shop in a country nobody has written a line of code for still sells, still
 * prints a label, and still emails a working tracking link on day one.
 *
 * It requires no credentials, so it is also the only adapter that cannot break
 * when a carrier rotates an API, deprecates a version, or asks for a contract.
 */

import { identify, normalise, trackingUrl } from '../tracking';
import type {
  Address, CarrierAdapter, Capabilities, CredentialField, Parcel, Shipment,
} from '../types';

const CAPABILITIES: Capabilities = {
  // Nothing is called out to, so nothing can be quoted, tracked or cancelled.
  // Saying so honestly is what lets the admin render the right form instead of
  // showing a shopkeeper buttons that would do nothing.
  rates: false,
  createShipment: true,
  label: true,
  track: false,
  cancel: false,
  pickup: false,
  serviceability: false,
};

export interface ManualInput {
  /** What the shopkeeper pasted. Whitespace and case are forgiven. */
  tracking: string;
  /**
   * The carrier's name, when the shopkeeper wants to override the guess.
   * Empty means "use whatever the number identifies as".
   */
  carrier?: string;
}

/**
 * Build the adapter.
 *
 * `urlTemplate` comes from settings and holds a `:tracking` placeholder. It is
 * what makes a carrier nobody has ever heard of work with no code: paste
 * `https://their-courier.example/track?id=:tracking` once and every dispatch
 * email is right from then on.
 */
export function manualCarrier(urlTemplate = ''): CarrierAdapter & {
  record(input: ManualInput & { orderId: string }): ManualRecord;
} {
  return {
    id: 'manual',
    name: 'Book it yourself',
    support: 'core',
    capabilities: CAPABILITIES,
    countries: [],
    requires: [] as readonly CredentialField[],

    async createShipment(input: {
      orderId: string;
      from: Address;
      to: Address;
      parcel: Parcel;
    }): Promise<Shipment> {
      // Deliberately unreachable through the automatic dispatch path. A manual
      // shipment exists because a human typed a number; there is nothing to
      // create. The admin calls `record` instead, and the flow that would have
      // called this never selects an adapter whose `createShipment` capability
      // is present but whose `rates` is not.
      throw new Error(
        `The manual carrier cannot create a shipment for ${input.orderId}. ` +
          `Book the parcel with your courier and enter the tracking number.`,
      );
    },

    record({ tracking, carrier }) {
      return recordManual(tracking, carrier, urlTemplate);
    },
  };
}

export interface ManualRecord {
  tracking: string;
  carrier: string;
  url: string | null;
  /**
   * False when the number matched a known format but failed its check digit.
   * The admin warns rather than refuses — a shopkeeper looking at the parcel
   * in their hands knows more than we do, and a carrier we have no pattern for
   * is the normal case, not an error.
   */
  looksValid: boolean;
  /** Why, in words a shopkeeper can act on. Empty when there is nothing to say. */
  warning: string;
}

export function recordManual(
  raw: string,
  carrierOverride: string | undefined,
  urlTemplate: string,
): ManualRecord {
  const tracking = normalise(raw);
  const guess = identify(tracking);

  // The shopkeeper's own template wins. They chose their courier; we only
  // guessed at it. A guess is a convenience, never an override.
  const url = (urlTemplate && trackingUrl(urlTemplate, tracking)) || guess?.url || null;

  const carrier = carrierOverride?.trim() || guess?.courier || 'Courier';

  let warning = '';
  if (guess && !guess.valid) {
    warning =
      `This looks like a ${guess.courier} number but its check digit is wrong, ` +
      `which usually means a typo. Check it against the parcel before dispatching.`;
  } else if (!guess && !url) {
    warning =
      `We do not recognise this number's format and no tracking link is set up, ` +
      `so the dispatch email will not include one. Add a tracking link in ` +
      `Settings > Delivery to fix that for every future order.`;
  }

  return {
    tracking,
    carrier,
    url,
    looksValid: guess ? guess.valid : true,
    warning,
  };
}
