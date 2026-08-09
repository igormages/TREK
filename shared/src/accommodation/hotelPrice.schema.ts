import { z } from 'zod';

/**
 * Market prices for the places you sleep in.
 *
 * A bed icon says a hotel is there; it doesn't say whether you can afford it.
 * Every accommodation map worth using draws the nightly rate on the map itself,
 * which is what turns a map into something you choose from rather than
 * something you read after choosing.
 *
 * The price is never entered by hand — a hand-typed rate is a rate nobody
 * re-checks, and a stale price is worse than no price. It comes from Hotellook
 * (Travelpayouts), which aggregates Booking/Agoda/Expedia and therefore covers
 * flats and guest houses as well as hotels. Only Airbnb-exclusive listings have
 * no quote, and those simply keep the plain circle marker.
 *
 * Amounts cross the wire as NUMBERS, never as preformatted strings: the marker
 * interpolates its label straight into HTML, so a string coming from a third
 * party would be an injection vector. The client formats with `formatMoney`.
 */

/** What a stay costs, as quoted for the dates the itinerary actually holds. */
export const hotelPriceSchema = z.object({
  /** The lodging place this was matched to. */
  place_id: z.number(),
  /** Cheapest quote for the whole stay, in `currency`. */
  price_from: z.number(),
  /** `price_from` divided by the nights booked — what the pill shows. */
  price_per_night: z.number(),
  currency: z.string(),
  nights: z.number(),
  /** The Hotellook property this was matched to, for the tooltip. */
  hotel_name: z.string().nullable(),
  stars: z.number().nullable(),
});
export type HotelPrice = z.infer<typeof hotelPriceSchema>;

export const tripHotelPricesResponseSchema = z.object({
  prices: z.array(hotelPriceSchema),
  /**
   * False when no Travelpayouts token is configured. The map then shows plain
   * circles and says nothing — an empty price list and a disabled integration
   * are different states, and only the second is worth telling an admin about.
   */
  configured: z.boolean(),
});
export type TripHotelPricesResponse = z.infer<typeof tripHotelPricesResponseSchema>;

/**
 * How close a Hotellook property must be to the place we hold before we accept
 * it as the same building, in kilometres. Hotels sit metres apart in a city
 * centre, so this is deliberately tight: a wrong match prices the hotel next
 * door, which is worse than showing nothing.
 */
export const HOTEL_MATCH_MAX_KM = 0.4;

/**
 * How alike the two names must read, from 0 to 1. Geography alone is not enough
 * — an apartment block can hold four listings — so the name has to agree too.
 */
export const HOTEL_MATCH_MIN_NAME_SCORE = 0.55;
