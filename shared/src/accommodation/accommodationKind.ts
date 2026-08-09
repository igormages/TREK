/**
 * What KIND of place you sleep in — hotel, hostel or rental.
 *
 * TREK has no column for this: an accommodation points at a place, and a place
 * carries a user-editable category ("Hotel", "Auberge", whatever the traveller
 * named it). So the kind is derived from that category and the place's own
 * name, which is where the distinction actually shows up in practice ("Sakura
 * Hostel Asakusa", "Appartement Chiado", "Ryokan Yoshida-sanso").
 *
 * It drives how a marker is drawn — gold hotel, blue hostel with a bunk bed,
 * grey rental with a house — and nothing else, so a wrong guess is cosmetic.
 * Keywords cover the languages a French-speaking traveller books in; anything
 * unrecognised falls back to `rental`, the neutral grey.
 */

export type AccommodationKind = 'hotel' | 'hostel' | 'rental';

// Order matters: the first list to match wins. "Auberge de jeunesse" has to be
// read as a hostel before the bare "auberge" of the hotel list claims it.
const HOSTEL = [
  'hostel',
  'auberge de jeunesse',
  'youth hostel',
  'backpack',
  'dorm',
  'dortoir',
  'albergue',
  'ostello',
  'jugendherberge',
];

const RENTAL = [
  'airbnb',
  'apartment',
  'appartement',
  'appartamento',
  'apartamento',
  'apart',
  'studio',
  'loft',
  'maison',
  'house',
  'villa',
  'chalet',
  'bungalow',
  'cottage',
  'gite',
  'gîte',
  'homestay',
  'guesthouse',
  'guest house',
  'chambre chez',
  'rental',
  'residence',
  'résidence',
  'ferienwohnung',
];

const HOTEL = [
  'hotel',
  'hôtel',
  'hostal',
  'motel',
  'resort',
  'ryokan',
  'auberge',
  'palace',
  'lodge',
  'riad',
  'pousada',
  'albergo',
];

/** Lowercased and stripped of accents, so "Hôtel" and "hotel" match the same list. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function matches(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(normalise(needle)));
}

/**
 * Reads the kind from any text describing the stay — typically the place's
 * category name and its own name.
 *
 * Returns null when nothing in the text names a kind of lodging, which is the
 * common case: most places on a trip are restaurants and viewpoints. Callers
 * that already know they hold an accommodation read the null as `rental`, the
 * neutral grey — a confident gold on a guess is worse than no guess.
 */
export function accommodationKind(...parts: (string | null | undefined)[]): AccommodationKind | null {
  const text = normalise(parts.filter(Boolean).join(' '));
  if (!text.trim()) return null;
  if (matches(text, HOSTEL)) return 'hostel';
  if (matches(text, RENTAL)) return 'rental';
  if (matches(text, HOTEL)) return 'hotel';
  return null;
}

/**
 * Lucide icon names TREK's category picker offers for somewhere you sleep
 * (see the client's CATEGORY_ICON_MAP / ICON_LABELS: "Hotel", "Accommodation",
 * "Camping"). The chosen icon is the most reliable signal a category means
 * lodging, because the category's *name* is free text in any language.
 */
export const LODGING_CATEGORY_ICONS = ['BedDouble', 'Home', 'Tent'];

/** Whether a place's category marks it as somewhere the traveller sleeps. */
export function isLodgingCategory(categoryIcon: string | null | undefined, categoryName?: string | null): boolean {
  if (categoryIcon && LODGING_CATEGORY_ICONS.includes(categoryIcon)) return true;
  return accommodationKind(categoryName) !== null;
}
