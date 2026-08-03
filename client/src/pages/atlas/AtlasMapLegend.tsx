import React from 'react'
import type { TranslationFn } from '../../types'
import type { MeteoLevel } from '@trek/shared'
import { METEO_LEVEL_COLORS } from '@trek/shared'

export type AtlasMapMode = 'security' | 'weather'

interface AtlasMapLegendProps {
  dark: boolean
  t: TranslationFn
  mode: AtlasMapMode
  onModeChange: (mode: AtlasMapMode) => void
  meteoMonth: number
  onMeteoMonthChange: (month: number) => void
}

const DIPLOMATIE_LEVELS = [
  { key: 'red', color: '#ef4444', labelKey: 'atlas.diplomatieLevelRed' },
  { key: 'orange', color: '#f97316', labelKey: 'atlas.diplomatieLevelOrange' },
  { key: 'yellow', color: '#eab308', labelKey: 'atlas.diplomatieLevelYellow' },
  { key: 'green', color: '#22c55e', labelKey: 'atlas.diplomatieLevelGreen' },
] as const

const METEO_LEVELS: MeteoLevel[] = [1, 2, 3, 4, 5]

const METEO_LABEL_KEYS: Record<MeteoLevel, string> = {
  1: 'atlas.meteoLevel1',
  2: 'atlas.meteoLevel2',
  3: 'atlas.meteoLevel3',
  4: 'atlas.meteoLevel4',
  5: 'atlas.meteoLevel5',
}

export default function AtlasMapLegend({
  dark,
  t,
  mode,
  onModeChange,
  meteoMonth,
  onMeteoMonthChange,
}: AtlasMapLegendProps): React.ReactElement {
  const bg = dark ? 'rgba(10,10,15,0.75)' : 'rgba(255,255,255,0.85)'
  const textColor = dark ? '#cbd5e1' : '#475569'
  const activeBg = dark ? 'rgba(99,102,241,0.35)' : 'rgba(99,102,241,0.15)'
  const inactiveBg = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'

  return (
    <div
      className="hidden md:block absolute z-10"
      style={{
        top: 16, left: 16, padding: '10px 14px', borderRadius: 12,
        background: bg, backdropFilter: 'blur(12px)',
        border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
        maxWidth: 220,
      }}
    >
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => onModeChange('security')}
          style={{
            flex: 1, padding: '5px 8px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
            background: mode === 'security' ? activeBg : inactiveBg,
            color: mode === 'security' ? (dark ? '#e2e8f0' : '#334155') : textColor,
          }}
        >
          {t('atlas.mapModeSecurity')}
        </button>
        <button
          type="button"
          onClick={() => onModeChange('weather')}
          style={{
            flex: 1, padding: '5px 8px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
            background: mode === 'weather' ? activeBg : inactiveBg,
            color: mode === 'weather' ? (dark ? '#e2e8f0' : '#334155') : textColor,
          }}
        >
          {t('atlas.mapModeWeather')}
        </button>
      </div>

      {mode === 'security' ? (
        <>
          <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: textColor }}>
            {t('atlas.diplomatieLegend')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {DIPLOMATIE_LEVELS.map(({ key, color, labelKey }) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 20, height: 12, borderRadius: 3, background: color, opacity: 0.7,
                  border: `1px dashed ${color}`,
                }} />
                <span style={{ fontSize: 10, color: textColor }}>{t(labelKey)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: textColor }}>
            {t('atlas.meteoLegend')}
          </p>
          <div style={{ marginBottom: 10 }}>
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={meteoMonth}
              onChange={(e) => onMeteoMonthChange(Number(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }}
              aria-label={t('atlas.meteoMonthSlider')}
            />
            <p style={{ margin: '6px 0 0', fontSize: 11, fontWeight: 600, color: dark ? '#e2e8f0' : '#334155', textAlign: 'center' }}>
              {t(`atlas.meteoMonth${meteoMonth}` as const)}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {METEO_LEVELS.map((level) => (
              <div key={level} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 20, height: 12, borderRadius: 3,
                  background: METEO_LEVEL_COLORS[level],
                  border: `1px solid ${dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'}`,
                }} />
                <span style={{ fontSize: 10, color: textColor }}>{t(METEO_LABEL_KEYS[level])}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
