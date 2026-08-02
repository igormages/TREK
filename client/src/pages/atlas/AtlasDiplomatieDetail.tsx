import React, { useEffect, useRef } from 'react'
import { X, ExternalLink } from 'lucide-react'
import type { TranslationFn } from '../../types'
import type { DiplomatieDetail } from '@trek/shared'
import { countryCodeToFlag } from './atlasModel'

interface AtlasDiplomatieDetailProps {
  detail: DiplomatieDetail | null
  loading: boolean
  dark: boolean
  t: TranslationFn
  onClose: () => void
}

export default function AtlasDiplomatieDetail({
  detail, loading, dark, t, onClose,
}: AtlasDiplomatieDetailProps): React.ReactElement | null {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contentRef.current) return
    const links = contentRef.current.querySelectorAll('a[href]')
    links.forEach((a) => {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    })
  }, [detail])

  if (!detail && !loading) return null

  const tp = dark ? '#f1f5f9' : '#0f172a'
  const tm = dark ? '#cbd5e1' : '#475569'

  return (
    <div
      className="bg-[rgba(0,0,0,0.5)]"
      style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}
    >
      <div
        className="bg-surface-card"
        style={{
          borderRadius: 16, maxWidth: 720, width: '100%', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color, rgba(0,0,0,0.08))', display: 'flex', alignItems: 'center', gap: 12 }}>
          {detail && <span style={{ fontSize: 32 }}>{countryCodeToFlag(detail.code)}</span>}
          <div style={{ flex: 1 }}>
            <h2 className="text-content" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              {loading ? t('atlas.diplomatieLoading') : detail?.name}
            </h2>
            <p className="text-content-muted" style={{ margin: '2px 0 0', fontSize: 11 }}>
              {t('atlas.diplomatieSourceLabel')}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: tm, padding: 4, display: 'flex' }}>
            <X size={20} />
          </button>
        </div>

        <div
          ref={contentRef}
          className="atlas-diplomatie-detail"
          style={{
            flex: 1, overflowY: 'auto', padding: '16px 20px 24px',
            fontSize: 13, lineHeight: 1.6, color: tm,
          }}
        >
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
              <div className="w-8 h-8 border-2 rounded-full animate-spin border-edge border-t-content" />
            </div>
          ) : detail?.sections.map(section => (
            <div key={section.id} style={{ marginBottom: 24 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700, color: tp, borderBottom: `2px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`, paddingBottom: 6 }}>
                {section.title}
              </h3>
              <div
                className="diplomatie-section-content"
                dangerouslySetInnerHTML={{ __html: section.html }}
                style={{ color: tm }}
              />
            </div>
          ))}
        </div>

        {detail && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color, rgba(0,0,0,0.08))', display: 'flex', justifyContent: 'flex-end' }}>
            <a href={detail.sourceUrl} target="_blank" rel="noopener noreferrer"
              className="text-accent"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
              <ExternalLink size={14} />
              {t('atlas.diplomatieViewSource')}
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
