import React from 'react'
import type { TranslationFn } from '../../types'

interface AtlasDiplomatieLegendProps {
  dark: boolean
  t: TranslationFn
}

const LEVELS = [
  { key: 'red', color: '#ef4444', labelKey: 'atlas.diplomatieLevelRed' },
  { key: 'orange', color: '#f97316', labelKey: 'atlas.diplomatieLevelOrange' },
  { key: 'yellow', color: '#eab308', labelKey: 'atlas.diplomatieLevelYellow' },
  { key: 'green', color: '#22c55e', labelKey: 'atlas.diplomatieLevelGreen' },
] as const

export default function AtlasDiplomatieLegend({ dark, t }: AtlasDiplomatieLegendProps): React.ReactElement {
  const bg = dark ? 'rgba(10,10,15,0.75)' : 'rgba(255,255,255,0.85)'
  const textColor = dark ? '#cbd5e1' : '#475569'

  return (
    <div
      className="hidden md:block absolute z-10"
      style={{
        top: 16, left: 16, padding: '10px 14px', borderRadius: 12,
        background: bg, backdropFilter: 'blur(12px)',
        border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
      }}
    >
      <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: textColor }}>
        {t('atlas.diplomatieLegend')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {LEVELS.map(({ key, color, labelKey }) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 20, height: 12, borderRadius: 3, background: color, opacity: 0.7,
              border: `1px dashed ${color}`,
            }} />
            <span style={{ fontSize: 10, color: textColor }}>{t(labelKey)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
