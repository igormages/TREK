import { useState } from 'react'
import ReactDOM from 'react-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Eye, Pencil } from 'lucide-react'
import { NOTE_ICONS } from './DayPlanSidebar.constants'

/** Body cap — matches dayNoteCreateRequestSchema.time and the server's MAX_LENGTHS. */
const BODY_MAX = 4000

interface NoteModalUi {
  mode: 'add' | 'edit'
  icon: string
  text: string
  time: string
  cost?: string
}

interface DayPlanSidebarNoteModalProps {
  noteUi: Record<string, NoteModalUi | undefined>
  setNoteUi: (updater: (prev: any) => any) => void
  noteInputRef: React.RefObject<HTMLInputElement>
  cancelNote: (dayId: number) => void
  saveNote: (dayId: number) => void
  currencySymbol?: string
  t: (key: string, params?: Record<string, any>) => string
}

export function DayPlanSidebarNoteModal({ noteUi, setNoteUi, noteInputRef, cancelNote, saveNote, currencySymbol, t }: DayPlanSidebarNoteModalProps) {
  // Preview is per-dialog, and only one note dialog is open at a time.
  const [preview, setPreview] = useState(false)

  return (
    <>
      {Object.entries(noteUi).map(([dayId, ui]) => ui && ReactDOM.createPortal(
        <div key={dayId} className="bg-[rgba(0,0,0,0.3)]" style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(3px)', padding: 16,
        }} onClick={() => { setPreview(false); cancelNote(Number(dayId)) }}>
          <div className="bg-surface-card" style={{
            width: 'min(620px, 100%)', maxHeight: '90vh', overflowY: 'auto', borderRadius: 16,
            boxShadow: '0 16px 48px rgba(0,0,0,0.22)', padding: '22px 22px 18px',
            display: 'flex', flexDirection: 'column', gap: 12,
          }} onClick={e => e.stopPropagation()}>
            <div className="text-content" style={{ fontSize: 'calc(14px * var(--fs-scale-body, 1))', fontWeight: 600 }}>
              {ui.mode === 'add' ? t('dayplan.noteAdd') : t('dayplan.noteEdit')}
            </div>
            {/* Icon picker */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {NOTE_ICONS.map(({ id, Icon }) => (
                <button key={id} onClick={() => setNoteUi(prev => ({ ...prev, [dayId]: { ...prev[dayId], icon: id } }))}
                  title={id}
                  className={ui.icon === id ? 'bg-surface-hover' : 'bg-transparent'}
                  style={{ width: 42, height: 42, borderRadius: 8, border: ui.icon === id ? '2px solid var(--text-primary)' : '2px solid var(--border-faint)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                  <Icon size={18} strokeWidth={1.8} color={ui.icon === id ? 'var(--text-primary)' : 'var(--text-muted)'} />
                </button>
              ))}
            </div>

            <input
              ref={noteInputRef}
              type="text"
              value={ui.text}
              maxLength={500}
              onChange={e => setNoteUi(prev => ({ ...prev, [dayId]: { ...prev[dayId], text: e.target.value } }))}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveNote(Number(dayId)) } if (e.key === 'Escape') cancelNote(Number(dayId)) }}
              placeholder={t('dayplan.noteTitle') + ' *'}
              required
              className="text-content"
              style={{ fontSize: 'calc(13px * var(--fs-scale-body, 1))', fontWeight: 500, border: '1px solid var(--border-primary)', borderRadius: 8, padding: '8px 10px', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }}
            />

            {/* Body — markdown, with a preview toggle so formatting can be checked
                without leaving the dialog. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span className="text-content-muted" style={{ fontSize: 'calc(11.5px * var(--fs-scale-caption, 1))', fontWeight: 600 }}>
                {t('dayplan.noteBody')}
              </span>
              <button type="button" onClick={() => setPreview(p => !p)}
                className="text-content-muted"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px solid var(--border-primary)', borderRadius: 7, padding: '4px 9px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'calc(11px * var(--fs-scale-caption, 1))' }}>
                {preview ? <Pencil size={11} /> : <Eye size={11} />}
                {preview ? t('dayplan.noteEditText') : t('dayplan.notePreview')}
              </button>
            </div>

            {preview ? (
              <div className="collab-note-md text-content" style={{
                minHeight: 200, maxHeight: 340, overflowY: 'auto',
                border: '1px solid var(--border-primary)', borderRadius: 8, padding: '10px 12px',
                fontSize: 'calc(12.5px * var(--fs-scale-body, 1))', lineHeight: 1.5, wordBreak: 'break-word',
              }}>
                {ui.time?.trim()
                  ? <Markdown remarkPlugins={[remarkGfm]}>{ui.time}</Markdown>
                  : <span className="text-content-faint">{t('dayplan.noteSubtitle')}</span>}
              </div>
            ) : (
              <textarea
                value={ui.time}
                maxLength={BODY_MAX}
                rows={10}
                onChange={e => setNoteUi(prev => ({ ...prev, [dayId]: { ...prev[dayId], time: e.target.value } }))}
                onKeyDown={e => { if (e.key === 'Escape') cancelNote(Number(dayId)) }}
                placeholder={t('dayplan.noteSubtitle')}
                className="text-content"
                style={{ fontSize: 'calc(12.5px * var(--fs-scale-body, 1))', border: '1px solid var(--border-primary)', borderRadius: 8, padding: '9px 12px', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5, minHeight: 200 }}
              />
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: -4 }}>
              <span className="text-content-faint" style={{ fontSize: 'calc(11px * var(--fs-scale-caption, 1))' }}>
                {t('dayplan.noteMarkdownHint')}
              </span>
              <span className={(ui.time?.length || 0) >= BODY_MAX - 100 ? 'text-[#d97706]' : 'text-content-faint'} style={{ fontSize: 'calc(11px * var(--fs-scale-caption, 1))', flexShrink: 0 }}>
                {ui.time?.length || 0}/{BODY_MAX}
              </span>
            </div>

            {/* Optional price carried by the note itself. */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="text-content-muted" style={{ fontSize: 'calc(11.5px * var(--fs-scale-caption, 1))', fontWeight: 600, flexShrink: 0 }}>
                {t('dayplan.noteCost')}
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={ui.cost ?? ''}
                onChange={e => setNoteUi(prev => ({ ...prev, [dayId]: { ...prev[dayId], cost: e.target.value } }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveNote(Number(dayId)) } if (e.key === 'Escape') cancelNote(Number(dayId)) }}
                placeholder="0"
                className="text-content"
                style={{ fontSize: 'calc(12.5px * var(--fs-scale-body, 1))', border: '1px solid var(--border-primary)', borderRadius: 8, padding: '7px 10px', fontFamily: 'inherit', outline: 'none', width: 130, boxSizing: 'border-box' }}
              />
              {currencySymbol && <span className="text-content-faint" style={{ fontSize: 'calc(12px * var(--fs-scale-body, 1))' }}>{currencySymbol}</span>}
            </label>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button onClick={() => { setPreview(false); cancelNote(Number(dayId)) }} className="text-content-muted" style={{ fontSize: 'calc(12px * var(--fs-scale-body, 1))', background: 'none', border: '1px solid var(--border-primary)', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>{t('common.cancel')}</button>
              <button onClick={() => { setPreview(false); saveNote(Number(dayId)) }} disabled={!ui.text?.trim()} className={!ui.text?.trim() ? 'bg-[var(--border-primary)] text-content-faint' : 'bg-accent text-accent-text'} style={{ fontSize: 'calc(12px * var(--fs-scale-body, 1))', border: 'none', borderRadius: 8, padding: '6px 16px', cursor: !ui.text?.trim() ? 'not-allowed' : 'pointer', fontWeight: 600, fontFamily: 'inherit', transition: 'background 0.15s, color 0.15s' }}>
                {ui.mode === 'add' ? t('common.add') : t('common.save')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ))}
    </>
  )
}
