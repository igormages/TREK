import { accommodationKind, isLodgingCategory } from './accommodationKind';

import { describe, it, expect } from 'vitest';

describe('accommodationKind', () => {
  it('reads a hotel from its category', () => {
    expect(accommodationKind('Hotel', 'Park Hyatt Tokyo')).toBe('hotel');
    expect(accommodationKind('Hôtel', 'Le Bristol')).toBe('hotel');
  });

  it('reads a hostel from the place name even when the category just says Hotel', () => {
    // The category is a coarse bucket the traveller picked once; the name is
    // where the distinction actually lives.
    expect(accommodationKind('Hotel', 'Sakura Hostel Asakusa')).toBe('hostel');
  });

  it('does not let the hotel list claim a youth hostel', () => {
    // "Auberge de jeunesse" contains "auberge", which is on the hotel list.
    expect(accommodationKind('Hébergement', 'Auberge de jeunesse de Kyoto')).toBe('hostel');
    expect(accommodationKind('Hébergement', 'Auberge du Vieux Puits')).toBe('hotel');
  });

  it('reads a rental from apartment and house wording', () => {
    expect(accommodationKind('Hotel', 'Appartement Chiado')).toBe('rental');
    expect(accommodationKind(null, 'Airbnb — Maison Bali')).toBe('rental');
    expect(accommodationKind('Logement', 'Villa Uluwatu')).toBe('rental');
  });

  it('recognises a ryokan as a hotel', () => {
    expect(accommodationKind(null, 'Ryokan Yoshida-sanso')).toBe('hotel');
  });

  it('returns null when nothing names a kind of lodging', () => {
    // Most places on a trip are restaurants and viewpoints; the caller decides
    // what an unrecognised accommodation looks like.
    expect(accommodationKind(null, 'Chez Marc')).toBeNull();
    expect(accommodationKind(null, null)).toBeNull();
    expect(accommodationKind('', '   ')).toBeNull();
    expect(accommodationKind('Restaurant', 'Sushi Dai')).toBeNull();
  });
});

describe('isLodgingCategory', () => {
  it('trusts the category icon, whatever the category is named', () => {
    // Category names are free text in any language; the picked icon is not.
    expect(isLodgingCategory('BedDouble', 'Schlafen')).toBe(true);
    expect(isLodgingCategory('Home', null)).toBe(true);
    expect(isLodgingCategory('Tent', null)).toBe(true);
  });

  it('falls back to reading the category name', () => {
    expect(isLodgingCategory(null, 'Hébergement hôtel')).toBe(true);
    expect(isLodgingCategory('MapPin', 'Auberge')).toBe(true);
  });

  it('leaves everything else alone', () => {
    expect(isLodgingCategory('UtensilsCrossed', 'Restaurant')).toBe(false);
    expect(isLodgingCategory(null, null)).toBe(false);
  });
});
