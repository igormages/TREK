import { describe, it, expect } from 'vitest'
import { computeWorkOverlap, resolveDayTimezone, zonedTimeToUtc, AWAKE_START, AWAKE_END } from './workOverlap'

describe('resolveDayTimezone', () => {
  it('resolves an IANA zone from coordinates', () => {
    expect(resolveDayTimezone(35.68, 139.76)).toBe('Asia/Tokyo')
    expect(resolveDayTimezone(-21.1, 55.5)).toBe('Indian/Reunion')
  })
  it('returns null without coordinates', () => {
    expect(resolveDayTimezone(null, null)).toBeNull()
    expect(resolveDayTimezone(undefined, 2)).toBeNull()
  })
})

describe('zonedTimeToUtc', () => {
  it('converts a Tokyo wall time to the right instant', () => {
    expect(zonedTimeToUtc('2027-04-05', 15, 'Asia/Tokyo').getTime())
      .toBe(Date.parse('2027-04-05T06:00:00Z'))
  })
  it('handles half-hour offsets (India)', () => {
    expect(zonedTimeToUtc('2027-01-15', 13, 'Asia/Kolkata').getTime())
      .toBe(Date.parse('2027-01-15T07:30:00Z'))
  })
})

describe('computeWorkOverlap', () => {
  it('covers the waking window inclusively', () => {
    const r = computeWorkOverlap('2027-04-05', 'Asia/Tokyo')
    expect(r.hours[0].localHour).toBe(AWAKE_START)
    expect(r.hours[r.hours.length - 1].localHour).toBe(AWAKE_END)
  })

  it('Tokyo in April (home on CEST): +7h, meetings 15h-23h local = 8h-16h home', () => {
    const r = computeWorkOverlap('2027-04-05', 'Asia/Tokyo')
    expect(r.offsetMinutes).toBe(7 * 60)
    expect(r.overlap).toEqual({ localStart: 15, localEnd: 24, homeStart: 8, homeEnd: 17 })
    expect(r.hours.find(h => h.localHour === 14)?.isWork).toBe(false)
    expect(r.hours.find(h => h.localHour === 15)?.isWork).toBe(true)
  })

  it('Phnom Penh in February (home on CET): +6h, meetings 14h-23h local', () => {
    const r = computeWorkOverlap('2027-02-20', 'Asia/Phnom_Penh')
    expect(r.offsetMinutes).toBe(6 * 60)
    expect(r.overlap).toEqual({ localStart: 14, localEnd: 24, homeStart: 8, homeEnd: 18 })
  })

  it('Réunion in June: +2h, the whole home work day fits the local day', () => {
    const r = computeWorkOverlap('2027-06-15', 'Indian/Reunion')
    expect(r.offsetMinutes).toBe(2 * 60)
    expect(r.overlap).toEqual({ localStart: 10, localEnd: 21, homeStart: 8, homeEnd: 19 })
  })

  it('India in January: half-hour offset maps 13h local to 8h30 home (work)', () => {
    const r = computeWorkOverlap('2027-01-15', 'Asia/Kolkata')
    expect(r.offsetMinutes).toBe(4 * 60 + 30)
    expect(r.hours.find(h => h.localHour === 13)?.isWork).toBe(true)
    expect(r.hours.find(h => h.localHour === 12)?.isWork).toBe(false)
  })

  it('tracks the home DST switch (Paris, 28 Mar 2027)', () => {
    expect(computeWorkOverlap('2027-03-27', 'Asia/Tokyo').offsetMinutes).toBe(8 * 60)
    expect(computeWorkOverlap('2027-03-29', 'Asia/Tokyo').offsetMinutes).toBe(7 * 60)
  })

  it('supports custom home work hours', () => {
    const r = computeWorkOverlap('2027-04-05', 'Asia/Tokyo', { workStart: 9, workEnd: 12 })
    expect(r.overlap).toEqual({ localStart: 16, localEnd: 19, homeStart: 9, homeEnd: 12 })
  })

  it('returns null overlap when nothing lines up', () => {
    // Same zone, but a home work window that sits entirely in the local night.
    const r = computeWorkOverlap('2027-04-05', 'Europe/Paris', { workStart: 3, workEnd: 6 })
    expect(r.overlap).toBeNull()
  })

  it('marks next-day home mornings as valid slots (far-east offsets)', () => {
    // Honolulu in April is 12h behind Paris: local 20h-23h = home 8h-11h (next day).
    const r = computeWorkOverlap('2027-04-05', 'Pacific/Honolulu')
    expect(r.offsetMinutes).toBe(-12 * 60)
    expect(r.overlap).toEqual({ localStart: 20, localEnd: 24, homeStart: 8, homeEnd: 12 })
  })
})
