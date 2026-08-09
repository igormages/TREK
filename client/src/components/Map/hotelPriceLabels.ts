import { formatMoney } from '../../utils/formatters'
import type { HotelPrice } from '@trek/shared'

/**
 * Turns quotes into the strings the markers draw.
 *
 * Shared by both map engines so a price reads the same whichever renderer the
 * instance runs, and — more importantly — formatted HERE rather than on the
 * server: `accommodationMarkerHtml` interpolates its label straight into an
 * HTML string, so the only text allowed through is text we built ourselves from
 * a number. A preformatted string from an affiliate API would be an injection.
 *
 * Rounded to whole units: a marker is read at a glance from across a city, and
 * "86 €" fits where "85,50 €" starts colliding with its neighbours.
 */
export function buildPriceLabels(
  prices: Record<number, HotelPrice> | undefined,
  locale: string,
): Record<number, string> {
  if (!prices) return {}
  const labels: Record<number, string> = {}
  for (const [placeId, price] of Object.entries(prices)) {
    if (!price || !(price.price_per_night > 0)) continue
    labels[Number(placeId)] = formatMoney(price.price_per_night, price.currency, locale, { decimals: 0 })
  }
  return labels
}
