import React from 'react'
import { X, ExternalLink, Thermometer, CloudRain, Plug, HeartPulse, CalendarDays } from 'lucide-react'
import type { TranslationFn } from '../../types'
import type { MeteoCountryDetail, MeteoLevel } from '@trek/shared'
import { METEO_LEVEL_COLORS } from '@trek/shared'
import { countryCodeToFlag } from './atlasModel'

const METEO_LABEL_KEYS: Record<MeteoLevel, string> = {
  1: 'atlas.meteoLevel1',
  2: 'atlas.meteoLevel2',
  3: 'atlas.meteoLevel3',
  4: 'atlas.meteoLevel4',
  5: 'atlas.meteoLevel5',
}

/** Levels 1-2 read fine on white text; 3-5 (yellow/green) need a dark label. */
const levelTextColor = (level: MeteoLevel): string => (level >= 3 ? '#1e293b' : '#7f1d1d')

interface AtlasMeteoPanelProps {
  code: string
  countryName: string
  detail: MeteoCountryDetail | null
  loading: boolean
  month: number
  onMonthChange: (month: number) => void
  dark: boolean
  t: TranslationFn
  onClose: () => void
  onMark?: () => void
  onUnmark?: () => void
  onAddToBucket?: () => void
  isVisited?: boolean
  isInBucketList?: boolean
  canUnmark?: boolean
}

/**
 * A-contresens climate panel — shown instead of the France Diplomatie advisory
 * panel when a country is clicked while the map is in weather mode. Surfaces
 * the per-month temperature/rain figures, why the selected month is (un)favorable,
 * plus the practical extras scraped from the country page: power plugs and the
 * health/vaccines section.
 */
export default function AtlasMeteoPanel({
  code, countryName, detail, loading, month, onMonthChange, dark, t, onClose,
  onMark, onUnmark, onAddToBucket, isVisited, isInBucketList, canUnmark,
}: AtlasMeteoPanelProps): React.ReactElement | null {
  const bg = dark ? 'rgba(10,10,15,0.92)' : 'rgba(255,255,255,0.96)'
  const tp = dark ? '#f1f5f9' : '#0f172a'
  const tm = dark ? '#94a3b8' : '#64748b'
  const tf = dark ? '#475569' : '#94a3b8'

  const selected = detail?.months.find(m => m.month === month) || null
  const level = selected?.level ?? null
  const levelColor = level ? METEO_LEVEL_COLORS[level] : (dark ? '#334155' : '#cbd5e1')
  const bestMonths = (detail?.months || []).filter(m => (m.level ?? 0) >= 4)

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
        <span style={{ fontSize: 28 }}>{countryCodeToFlag(code)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: tp, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {countryName || detail?.name || code}
          </p>
          {level && (
            <span style={{
              display: 'inline-block', marginTop: 4, padding: '2px 8px', borderRadius: 6,
              fontSize: 10, fontWeight: 700, color: levelTextColor(level), background: levelColor,
            }}>
              {t(`atlas.meteoMonth${month}` as const)} · {selected?.levelLabel || t(METEO_LABEL_KEYS[level])}
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
        ) : !detail ? (
          <p style={{ margin: 0, fontSize: 12, color: tm }}>{t('atlas.meteoNoData')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Selected month figures — the "why (un)favorable" at a glance */}
            {selected && (selected.tempC != null || selected.rainMm != null || level) && (
              <Section icon={Thermometer} title={t('atlas.meteoClimateIn', { month: t(`atlas.meteoMonth${month}` as const) })} labelColor={tf}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
                  {selected.tempC != null && (
                    <div style={{ flex: 1, padding: '8px 10px', borderRadius: 10, background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: tf, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Thermometer size={10} /> {t('atlas.meteoAvgTemp')}
                      </span>
                      <span style={{ fontSize: 18, fontWeight: 800, color: tp }}>{selected.tempC}°C</span>
                    </div>
                  )}
                  {selected.rainMm != null && (
                    <div style={{ flex: 1, padding: '8px 10px', borderRadius: 10, background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: tf, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <CloudRain size={10} /> {t('atlas.meteoRain')}
                      </span>
                      <span style={{ fontSize: 18, fontWeight: 800, color: tp }}>{selected.rainMm} mm</span>
                    </div>
                  )}
                </div>
                {level && (
                  <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.5, color: tm }}>
                    {t(level >= 4 ? 'atlas.meteoReasonGood' : level === 3 ? 'atlas.meteoReasonOk' : 'atlas.meteoReasonBad', {
                      month: t(`atlas.meteoMonth${month}` as const),
                      level: (selected?.levelLabel || t(METEO_LABEL_KEYS[level])).toLowerCase(),
                    })}
                  </p>
                )}
              </Section>
            )}

            {/* Month-by-month strip — click a cell to change the map month */}
            <Section icon={CalendarDays} title={t('atlas.meteoMonths')} labelColor={tf}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 3 }}>
                {detail.months.map((m) => {
                  const c = m.level ? METEO_LEVEL_COLORS[m.level] : (dark ? '#1e293b' : '#e2e8f0')
                  const isSel = m.month === month
                  return (
                    <button
                      key={m.month}
                      type="button"
                      onClick={() => onMonthChange(m.month)}
                      title={`${t(`atlas.meteoMonth${m.month}` as const)}${m.tempC != null ? ` · ${m.tempC}°C` : ''}${m.rainMm != null ? ` · ${m.rainMm}mm` : ''}${m.levelLabel ? ` · ${m.levelLabel}` : ''}`}
                      style={{
                        padding: 0, border: 'none', cursor: 'pointer', background: 'none',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                      }}
                    >
                      <span style={{
                        width: '100%', height: 22, borderRadius: 4, background: c,
                        outline: isSel ? `2px solid ${dark ? '#818cf8' : '#4f46e5'}` : 'none',
                        outlineOffset: 1,
                      }} />
                      <span style={{ fontSize: 8, fontWeight: isSel ? 800 : 600, color: isSel ? tp : tf }}>
                        {t(`atlas.meteoMonth${m.month}` as const).slice(0, 1)}
                      </span>
                    </button>
                  )
                })}
              </div>
              {bestMonths.length > 0 && (
                <p style={{ margin: '8px 0 0', fontSize: 11, lineHeight: 1.6, color: tm }}>
                  <span style={{ fontWeight: 700, color: tp }}>{t('atlas.meteoBestMonths')} : </span>
                  {bestMonths.map((m, i) => (
                    <React.Fragment key={m.month}>
                      {i > 0 && ', '}
                      <span style={{
                        padding: '1px 6px', borderRadius: 5, fontWeight: 700,
                        background: METEO_LEVEL_COLORS[m.level as MeteoLevel],
                        color: levelTextColor(m.level as MeteoLevel), fontSize: 10,
                      }}>
                        {t(`atlas.meteoMonth${m.month}` as const)}
                      </span>
                    </React.Fragment>
                  ))}
                </p>
              )}
              {detail.annualSummary && (
                <p style={{ margin: '8px 0 0', fontSize: 11, lineHeight: 1.5, color: tm }}>{detail.annualSummary}</p>
              )}
            </Section>

            {/* Power plugs */}
            {detail.electricity && (
              <Section icon={Plug} title={t('atlas.meteoPlugs')} labelColor={tf}>
                {detail.electricity.headline && (
                  <p style={{
                    margin: '0 0 6px', fontSize: 12, fontWeight: 700,
                    color: detail.electricity.needsAdapter === true ? '#ef4444' : detail.electricity.needsAdapter === false ? '#22c55e' : tp,
                  }}>
                    {detail.electricity.headline}
                  </p>
                )}
                {detail.electricity.plugTypes.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                    {detail.electricity.plugTypes.map((p) => (
                      <span key={p} style={{
                        padding: '3px 10px', borderRadius: 8, fontSize: 11, fontWeight: 800,
                        background: dark ? 'rgba(129,140,248,0.2)' : 'rgba(79,70,229,0.1)',
                        color: dark ? '#a5b4fc' : '#4f46e5',
                      }}>
                        {t('atlas.meteoPlugType', { type: p })}
                      </span>
                    ))}
                  </div>
                )}
                {detail.electricity.description && (
                  <p style={{ margin: '0 0 4px', fontSize: 11, lineHeight: 1.5, color: tm }}>{detail.electricity.description}</p>
                )}
                {detail.electricity.voltageText && (
                  <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: tm }}>{detail.electricity.voltageText}</p>
                )}
              </Section>
            )}

            {/* Health / vaccines */}
            {detail.health && (
              <Section icon={HeartPulse} title={t('atlas.meteoHealth')} labelColor={tf}>
                {detail.health.headline && (
                  <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: tp }}>{detail.health.headline}</p>
                )}
                {detail.health.vaccines.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <p style={{ margin: '0 0 4px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, color: tf }}>
                      {t('atlas.meteoVaccines')}
                    </p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {detail.health.vaccines.map((v) => (
                        <span key={v} style={{
                          padding: '3px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                          background: dark ? 'rgba(251,191,36,0.15)' : 'rgba(217,119,6,0.1)',
                          color: dark ? '#fbbf24' : '#b45309',
                        }}>
                          {v}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {detail.health.sections.map((s) => (
                  <details key={s.title} style={{ marginTop: 4 }}>
                    <summary style={{ fontSize: 11, fontWeight: 700, color: tp, cursor: 'pointer' }}>{s.title}</summary>
                    <p style={{ margin: '4px 0 0', fontSize: 11, lineHeight: 1.5, color: tm }}>{s.text}</p>
                  </details>
                ))}
              </Section>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: '10px 16px 14px', borderTop: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {detail && (
          <a href={detail.sourceUrl} target="_blank" rel="noopener noreferrer"
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
              background: dark ? 'rgba(129,140,248,0.2)' : 'rgba(79,70,229,0.1)',
              color: dark ? '#a5b4fc' : '#4f46e5', fontSize: 12, fontWeight: 600,
              textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
            <ExternalLink size={13} /> {t('atlas.meteoViewSource')}
          </a>
        )}
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
      </div>
    </div>
  )
}

function Section({ icon: Icon, title, labelColor, children }: {
  icon: React.ComponentType<{ size: number; style?: React.CSSProperties }>
  title: string
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
