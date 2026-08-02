import React from 'react'
import { X, ExternalLink, AlertTriangle, FileText, Plane } from 'lucide-react'
import type { TranslationFn } from '../../types'
import type { DiplomatieSummary, DiplomatieAdvisoryLevel } from '@trek/shared'
import { countryCodeToFlag } from './atlasModel'

const LEVEL_COLORS: Record<DiplomatieAdvisoryLevel, string> = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  unknown: '#94a3b8',
}

interface AtlasDiplomatiePanelProps {
  summary: DiplomatieSummary | null
  loading: boolean
  dark: boolean
  t: TranslationFn
  onClose: () => void
  onDetail: () => void
  onMark?: () => void
  onUnmark?: () => void
  onAddToBucket?: () => void
  isVisited?: boolean
  isInBucketList?: boolean
  canUnmark?: boolean
}

export default function AtlasDiplomatiePanel({
  summary, loading, dark, t, onClose, onDetail, onMark, onUnmark, onAddToBucket, isVisited, isInBucketList, canUnmark,
}: AtlasDiplomatiePanelProps): React.ReactElement | null {
  if (!summary && !loading) return null

  const bg = dark ? 'rgba(10,10,15,0.92)' : 'rgba(255,255,255,0.96)'
  const tp = dark ? '#f1f5f9' : '#0f172a'
  const tm = dark ? '#94a3b8' : '#64748b'
  const tf = dark ? '#475569' : '#94a3b8'
  const level = summary?.level ?? 'unknown'
  const levelColor = LEVEL_COLORS[level]

  return (
    <div
      className="absolute z-20 overflow-hidden"
      style={{
        top: 16, right: 16, width: 360, maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100% - 200px)', background: bg,
        backdropFilter: 'blur(20px)', borderRadius: 16,
        border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        {summary && <span style={{ fontSize: 28 }}>{countryCodeToFlag(summary.code)}</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: tp, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {loading ? t('atlas.diplomatieLoading') : summary?.name}
          </p>
          {summary && (
            <span style={{
              display: 'inline-block', marginTop: 4, padding: '2px 8px', borderRadius: 6,
              fontSize: 10, fontWeight: 600, color: '#fff', background: levelColor,
            }}>
              {summary.levelLabel}
            </span>
          )}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: tf, padding: 4, display: 'flex' }}>
          <X size={18} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
            <div className="w-6 h-6 border-2 rounded-full animate-spin border-edge border-t-content" />
          </div>
        ) : summary && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {summary.risks && (
              <Section icon={AlertTriangle} title={t('atlas.diplomatieRisks')} color={tp} labelColor={tf}>
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: tm }}>{summary.risks}</p>
              </Section>
            )}
            {summary.visa && (
              <Section icon={Plane} title={t('atlas.diplomatieVisa')} color={tp} labelColor={tf}>
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: tm }}>{summary.visa}</p>
              </Section>
            )}
            {summary.otherInfo && (
              <Section icon={FileText} title={t('atlas.diplomatieOther')} color={tp} labelColor={tf}>
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: tm }}>{summary.otherInfo}</p>
              </Section>
            )}
            {summary.lastUpdated && (
              <p style={{ margin: 0, fontSize: 10, color: tf }}>
                {t('atlas.diplomatieUpdated')}: {summary.lastUpdated}
              </p>
            )}
          </div>
        )}
      </div>

      {summary && (
        <div style={{ padding: '10px 16px 14px', borderTop: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={onDetail}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: dark ? 'rgba(129,140,248,0.2)' : 'rgba(79,70,229,0.1)',
              color: dark ? '#a5b4fc' : '#4f46e5', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
            }}>
            {t('atlas.diplomatieDetail')}
          </button>
          {!isVisited && onMark && (
            <button onClick={onMark}
              style={{
                padding: '8px 12px', borderRadius: 10, border: `1px solid ${dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'}`,
                background: 'none', cursor: 'pointer', color: tp, fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              }}>
              {t('atlas.markVisited')}
            </button>
          )}
          {!isInBucketList && onAddToBucket && (
            <button onClick={onAddToBucket}
              style={{
                padding: '8px 12px', borderRadius: 10, border: `1px solid ${dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'}`,
                background: 'none', cursor: 'pointer', color: dark ? '#fbbf24' : '#d97706', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              }}>
              {t('atlas.addToBucket')}
            </button>
          )}
          {isVisited && canUnmark && onUnmark && (
            <button onClick={onUnmark}
              style={{
                padding: '8px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              }}>
              {t('atlas.unmark')}
            </button>
          )}
          <a href={summary.sourceUrl} target="_blank" rel="noopener noreferrer"
            style={{
              padding: '8px 10px', borderRadius: 10, display: 'flex', alignItems: 'center',
              color: tf, textDecoration: 'none',
            }}
            title={t('atlas.diplomatieSource')}>
            <ExternalLink size={14} />
          </a>
        </div>
      )}
    </div>
  )
}

function Section({ icon: Icon, title, color, labelColor, children }: {
  icon: React.ComponentType<{ size: number; style?: React.CSSProperties }>
  title: string
  color: string
  labelColor: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Icon size={13} style={{ color: labelColor }} />
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: labelColor }}>{title}</span>
      </div>
      {children}
    </div>
  )
}
