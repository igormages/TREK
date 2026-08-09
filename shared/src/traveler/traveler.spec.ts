import { ageOn, countTravelers, isValidBirthDate } from './traveler';

import { describe, it, expect } from 'vitest';

describe('isValidBirthDate', () => {
  it('accepts a real calendar date', () => {
    expect(isValidBirthDate('2026-09-18')).toBe(true);
  });

  it('rejects a day that does not exist', () => {
    expect(isValidBirthDate('2027-02-30')).toBe(false);
    expect(isValidBirthDate('2027-13-01')).toBe(false);
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    expect(isValidBirthDate('18/09/2026')).toBe(false);
    expect(isValidBirthDate('2026-9-8')).toBe(false);
    expect(isValidBirthDate('')).toBe(false);
  });
});

describe('ageOn', () => {
  it('counts whole years elapsed', () => {
    expect(ageOn('2026-09-18', '2028-09-18')).toBe(2);
  });

  it('does not count a birthday that has not come round yet', () => {
    expect(ageOn('2026-09-18', '2028-09-17')).toBe(1);
  });

  it('returns null when there is no usable birth date', () => {
    expect(ageOn(null, '2027-03-01')).toBeNull();
    expect(ageOn(undefined, '2027-03-01')).toBeNull();
    expect(ageOn('nope', '2027-03-01')).toBeNull();
  });
});

describe('countTravelers', () => {
  const family = [{ birth_date: '1990-01-01' }, { birth_date: '1992-05-20' }, { birth_date: '2026-09-18' }];

  it('leaves the under-two out of the adult count', () => {
    // The trip's own dates decide, not today: the baby is 5 months old here.
    expect(countTravelers(family, '2027-03-01')).toEqual({ adults: 2, infants: 1 });
  });

  it('counts the same child as an occupant once past two', () => {
    expect(countTravelers(family, '2029-03-01')).toEqual({ adults: 3, infants: 0 });
  });

  it('treats a missing birth date as an adult', () => {
    // The behaviour before birth dates existed — it never under-books a room.
    expect(countTravelers([{ birth_date: null }, {}], '2027-03-01')).toEqual({
      adults: 2,
      infants: 0,
    });
  });

  it('counts a baby born on the check-in day as an infant', () => {
    expect(countTravelers([{ birth_date: '2027-03-01' }], '2027-03-01')).toEqual({
      adults: 0,
      infants: 1,
    });
  });
});
