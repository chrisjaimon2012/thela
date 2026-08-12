/**
 * The carrier registry.
 *
 * Adding a carrier is adding a file and one line here. Nothing else in thela
 * knows a carrier's name, and no page or endpoint ever branches on one — that
 * is what makes a contributed adapter a contribution rather than a fork.
 *
 * WHAT `support` IS FOR, AND WHY IT IS SHOWN TO SHOPKEEPERS
 *
 * Core can only promise to maintain an adapter a maintainer can actually
 * exercise: you cannot fix a Colissimo integration without a French commercial
 * contract, because Colissimo issues no test accounts. Pretending otherwise
 * would mean a shopkeeper in Lyon discovers the truth the week their parcels
 * stop dispatching.
 *
 * So the level is displayed next to the carrier's name, with the date it was
 * last exercised against the live API. "Community, last verified 14 months ago"
 * is something a shopkeeper can weigh. "Community" alone is not, and a silent
 * list of equals is worse than either.
 */

import { manualCarrier } from './adapters/manual';
import type { CarrierAdapter } from './types';

export interface CarrierChoice {
  id: string;
  name: string;
  support: CarrierAdapter['support'];
  lastVerifiedLive?: string;
  countries: readonly string[];
  requires: readonly { key: string; label: string; secret: boolean; help?: string }[];
  /** Rendered in the admin so a shopkeeper knows what they are choosing. */
  note: string;
}

/**
 * Build the adapter a shop has configured.
 *
 * Returns `manual` for anything unrecognised rather than throwing. A settings
 * row naming an adapter that was removed — or misspelled by hand — must not
 * take the shop down; it must fall back to the mode that always works and let
 * the admin say so.
 */
export function carrierFor(id: string, opts: { trackingUrlTemplate?: string } = {}): CarrierAdapter {
  switch (id) {
    case 'manual':
    default:
      return manualCarrier(opts.trackingUrlTemplate ?? '');
  }
}

/** Everything a shop could choose, for the admin's dropdown. */
export function carrierChoices(): CarrierChoice[] {
  const manual = manualCarrier();
  return [
    {
      id: manual.id,
      name: manual.name,
      support: manual.support,
      countries: manual.countries,
      requires: manual.requires,
      note:
        'You book the parcel with your courier as usual and enter the tracking ' +
        'number here. Works with any carrier, anywhere, with no account to set up.',
    },
  ];
}

/** Plain-language wording for a support level. Used verbatim in the admin. */
export const SUPPORT_NOTE: Record<CarrierAdapter['support'], string> = {
  core: 'Maintained and tested by the thela project against a live account.',
  community:
    'Contributed and reviewed, but nobody on the project can test it against a ' +
    'live account. If it breaks, you may be the one who finds out.',
  experimental:
    'Incomplete or unverified. Expect to check every shipment by hand.',
};
