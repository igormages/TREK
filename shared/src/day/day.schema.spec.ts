import { dayCreateRequestSchema, dayNoteCreateRequestSchema, dayNoteUpdateRequestSchema } from './day.schema';

import { describe, it, expect } from 'vitest';

describe('dayCreateRequestSchema', () => {
  it('accepts an optional date + notes', () => {
    expect(dayCreateRequestSchema.safeParse({}).success).toBe(true);
    expect(dayCreateRequestSchema.safeParse({ date: '2026-07-01', notes: 'n' }).success).toBe(true);
  });
});

describe('dayNoteCreateRequestSchema', () => {
  it('requires non-empty text capped at 500, body capped at 4000', () => {
    expect(dayNoteCreateRequestSchema.safeParse({ text: 'Lunch' }).success).toBe(true);
    expect(dayNoteCreateRequestSchema.safeParse({ text: '' }).success).toBe(false);
    expect(dayNoteCreateRequestSchema.safeParse({ text: 'x'.repeat(501) }).success).toBe(false);
    // `time` carries the markdown body, so a real paragraph has to fit.
    expect(
      dayNoteCreateRequestSchema.safeParse({ text: 'ok', time: 'y'.repeat(2000) }).success,
    ).toBe(true);
    expect(
      dayNoteCreateRequestSchema.safeParse({ text: 'ok', time: 'y'.repeat(4001) }).success,
    ).toBe(false);
  });

  it('accepts an optional cost and allows clearing it with null', () => {
    expect(dayNoteCreateRequestSchema.safeParse({ text: 'Taxi', cost: 35.5 }).success).toBe(true);
    expect(dayNoteCreateRequestSchema.safeParse({ text: 'Taxi', cost: null }).success).toBe(true);
    expect(dayNoteCreateRequestSchema.safeParse({ text: 'Taxi', cost: 'free' }).success).toBe(false);
  });
});

describe('dayNoteUpdateRequestSchema', () => {
  it('allows omitting text and caps the lengths', () => {
    expect(dayNoteUpdateRequestSchema.safeParse({}).success).toBe(true);
    expect(dayNoteUpdateRequestSchema.safeParse({ icon: '🍽️' }).success).toBe(true);
    expect(dayNoteUpdateRequestSchema.safeParse({ text: 'x'.repeat(501) }).success).toBe(false);
    expect(dayNoteUpdateRequestSchema.safeParse({ time: 'y'.repeat(4001) }).success).toBe(false);
    expect(dayNoteUpdateRequestSchema.safeParse({ cost: 12 }).success).toBe(true);
    expect(dayNoteUpdateRequestSchema.safeParse({ cost: null }).success).toBe(true);
  });
});
