import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDayNotes } from '../../../src/hooks/useDayNotes';
import { useTripStore } from '../../../src/store/tripStore';
import { TranslationProvider } from '../../../src/i18n/TranslationContext';
import { buildDayNote } from '../../helpers/factories';
import { resetAllStores } from '../../helpers/store';

/**
 * A day note can carry its own price. The field is edited as text (so a
 * half-typed "12." survives) and normalized on save.
 */

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(TranslationProvider, null, children);

const TRIP_ID = 1;
const DAY_ID = 10;

describe('useDayNotes — cost', () => {
  beforeEach(() => {
    resetAllStores();
    vi.clearAllMocks();
  });

  it('opens an existing note with its cost prefilled as text', () => {
    const note = buildDayNote({ id: 5, day_id: DAY_ID, text: 'Transfer', cost: 35.5 });
    const { result } = renderHook(() => useDayNotes(TRIP_ID), { wrapper });

    act(() => result.current.openEditNote(DAY_ID, note));

    expect(result.current.noteUi[DAY_ID]).toMatchObject({ mode: 'edit', cost: '35.5' });
  });

  it('leaves the cost field empty for a note that has none', () => {
    const note = buildDayNote({ id: 5, day_id: DAY_ID, text: 'Transfer' });
    const { result } = renderHook(() => useDayNotes(TRIP_ID), { wrapper });

    act(() => result.current.openEditNote(DAY_ID, note));

    expect(result.current.noteUi[DAY_ID].cost).toBe('');
  });

  it('saves a typed cost as a number', async () => {
    const addDayNote = vi.fn().mockResolvedValue(undefined);
    useTripStore.setState({ addDayNote } as never);
    const { result } = renderHook(() => useDayNotes(TRIP_ID), { wrapper });

    act(() => result.current.openAddNote(DAY_ID, () => []));
    act(() => result.current.setNoteUi(prev => ({ ...prev, [DAY_ID]: { ...prev[DAY_ID], text: 'Taxi', cost: '42.75' } })));
    await act(async () => { await result.current.saveNote(DAY_ID) });

    await waitFor(() => expect(addDayNote).toHaveBeenCalled());
    expect(addDayNote.mock.calls[0][2]).toMatchObject({ text: 'Taxi', cost: 42.75 });
  });

  it('accepts a comma decimal separator', async () => {
    const addDayNote = vi.fn().mockResolvedValue(undefined);
    useTripStore.setState({ addDayNote } as never);
    const { result } = renderHook(() => useDayNotes(TRIP_ID), { wrapper });

    act(() => result.current.openAddNote(DAY_ID, () => []));
    act(() => result.current.setNoteUi(prev => ({ ...prev, [DAY_ID]: { ...prev[DAY_ID], text: 'Taxi', cost: '12,50' } })));
    await act(async () => { await result.current.saveNote(DAY_ID) });

    await waitFor(() => expect(addDayNote).toHaveBeenCalled());
    expect(addDayNote.mock.calls[0][2].cost).toBe(12.5);
  });

  it('clears the price when the cost field is emptied', async () => {
    const updateDayNote = vi.fn().mockResolvedValue(undefined);
    useTripStore.setState({ updateDayNote } as never);
    const note = buildDayNote({ id: 5, day_id: DAY_ID, text: 'Transfer', cost: 35 });
    const { result } = renderHook(() => useDayNotes(TRIP_ID), { wrapper });

    act(() => result.current.openEditNote(DAY_ID, note));
    act(() => result.current.setNoteUi(prev => ({ ...prev, [DAY_ID]: { ...prev[DAY_ID], cost: '' } })));
    await act(async () => { await result.current.saveNote(DAY_ID) });

    await waitFor(() => expect(updateDayNote).toHaveBeenCalled());
    expect(updateDayNote.mock.calls[0][3].cost).toBeNull();
  });

  it('never saves NaN for an unparseable cost', async () => {
    const addDayNote = vi.fn().mockResolvedValue(undefined);
    useTripStore.setState({ addDayNote } as never);
    const { result } = renderHook(() => useDayNotes(TRIP_ID), { wrapper });

    act(() => result.current.openAddNote(DAY_ID, () => []));
    act(() => result.current.setNoteUi(prev => ({ ...prev, [DAY_ID]: { ...prev[DAY_ID], text: 'Taxi', cost: 'abc' } })));
    await act(async () => { await result.current.saveNote(DAY_ID) });

    await waitFor(() => expect(addDayNote).toHaveBeenCalled());
    expect(addDayNote.mock.calls[0][2].cost).toBeNull();
  });

  it('keeps the note body intact when it is long', async () => {
    const addDayNote = vi.fn().mockResolvedValue(undefined);
    useTripStore.setState({ addDayNote } as never);
    const body = 'Ligne 1\n\n- point A\n- point B\n\n**gras** et *italique*'.repeat(10);
    const { result } = renderHook(() => useDayNotes(TRIP_ID), { wrapper });

    act(() => result.current.openAddNote(DAY_ID, () => []));
    act(() => result.current.setNoteUi(prev => ({ ...prev, [DAY_ID]: { ...prev[DAY_ID], text: 'Istanbul', time: body } })));
    await act(async () => { await result.current.saveNote(DAY_ID) });

    await waitFor(() => expect(addDayNote).toHaveBeenCalled());
    expect(addDayNote.mock.calls[0][2].time).toBe(body);
  });
});
