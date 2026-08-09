/**
 * Booking-style markers for the places you sleep in.
 *
 * A bed icon in a coloured circle tells you a hotel is there; it doesn't tell
 * you which one to pick. A price pill does — which is why every accommodation
 * map worth using draws the nightly rate on the map itself.
 *
 * The colour carries the kind, so a glance over a city separates the three
 * things a traveller weighs differently:
 *   gold  — hotel      (a room, a reception, a price per night)
 *   blue  — hostel     (bunk bed: dorms and shared bathrooms)
 *   grey  — rental     (house: a whole flat, self check-in, no desk)
 *
 * Both map engines build their markers from HTML strings, so this module
 * returns HTML rather than React — MapView (Leaflet) and MapViewGL (Mapbox)
 * share it verbatim.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Hotel, Home } from 'lucide-react'
import type { AccommodationKind } from '@trek/shared'

interface KindStyle {
  /** Pill background, and the circle fill when there is no price. */
  bg: string
  /** Text and icon colour — dark on gold, white on the other two. */
  fg: string
  border: string
}

export const ACCOMMODATION_STYLE: Record<AccommodationKind, KindStyle> = {
  // Gold reads as "hotel" the way it does on a star rating; the dark ink keeps
  // the price legible, which white on gold does not.
  hotel: { bg: '#D4A017', fg: '#1F1300', border: '#F5D06B' },
  hostel: { bg: '#2563EB', fg: '#FFFFFF', border: '#93B4FF' },
  rental: { bg: '#6B7280', fg: '#FFFFFF', border: '#D1D5DB' },
}

/**
 * A bunk bed — two stacked frames. Lucide has no such icon, and a plain bed
 * would be indistinguishable from the hotel one at marker size, which is the
 * whole point of drawing hostels differently.
 */
function bunkBedSvg(size: number, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 3v18"/><path d="M21 8V3"/>
    <path d="M3 12h18"/><path d="M21 12V8H3"/>
    <path d="M3 21h18"/><path d="M21 21v-4H3"/>
    <circle cx="7" cy="6" r="1.2"/><circle cx="7" cy="15" r="1.2"/>
  </svg>`
}

function kindIconSvg(kind: AccommodationKind, size: number, color: string): string {
  if (kind === 'hostel') return bunkBedSvg(size, color)
  const Icon = kind === 'hotel' ? Hotel : Home
  try {
    return renderToStaticMarkup(createElement(Icon, { size, color, strokeWidth: 2.4 }))
  } catch {
    return ''
  }
}

export interface AccommodationMarkerOptions {
  kind: AccommodationKind
  /** Formatted and ready to draw ("86 €"). Absent when no price is known. */
  priceLabel?: string | null
  isSelected?: boolean
}

/**
 * The marker's inner HTML. Sized by its content: a pill when there is a price,
 * a circle when there isn't — a pill reading only an icon would claim the
 * width of a price it doesn't have.
 */
export function accommodationMarkerHtml({
  kind,
  priceLabel,
  isSelected = false,
}: AccommodationMarkerOptions): { html: string; width: number; height: number } {
  const style = ACCOMMODATION_STYLE[kind]
  const height = isSelected ? 30 : 26
  const iconSize = isSelected ? 15 : 13
  const shadow = isSelected
    ? '0 0 0 3px rgba(17,24,39,0.22), 0 4px 12px rgba(0,0,0,0.32)'
    : '0 2px 7px rgba(0,0,0,0.26)'
  const icon = kindIconSvg(kind, iconSize, style.fg)

  if (!priceLabel) {
    const size = height
    return {
      width: size,
      height: size,
      html: `<div style="
        width:${size}px;height:${size}px;border-radius:50%;
        background:${style.bg};border:2px solid ${isSelected ? '#111827' : style.border};
        box-shadow:${shadow};
        display:flex;align-items:center;justify-content:center;cursor:pointer;
      ">${icon}</div>`,
    }
  }

  // Roughly 7.2px per character at 12px semibold, plus the icon and padding.
  // Only used to anchor the marker on the map, so an estimate is enough.
  const width = Math.round(26 + iconSize + priceLabel.length * 7.2)
  return {
    width,
    height,
    html: `<div style="
      height:${height}px;border-radius:${height / 2}px;
      background:${style.bg};border:2px solid ${isSelected ? '#111827' : style.border};
      box-shadow:${shadow};
      display:inline-flex;align-items:center;gap:4px;
      padding:0 9px 0 7px;cursor:pointer;white-space:nowrap;
      font-family:var(--font-system);font-size:${isSelected ? 12.5 : 11.5}px;
      font-weight:700;color:${style.fg};line-height:1;
    ">${icon}<span>${priceLabel}</span></div>`,
  }
}
