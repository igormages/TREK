import { useMemo } from 'react'
import { Briefcase } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useSettingsStore } from '../../store/settingsStore'
import {
  computeWorkOverlap, resolveDayTimezone,
  DEFAULT_HOME_TZ, DEFAULT_WORK_START, DEFAULT_WORK_END,
} from '../../utils/workOverlap'

interface WorkOverlapStripProps {
  dateStr: string
  lat: number | null
  lng: number | null
}

/**
 * Hour strip showing which LOCAL hours (08-23) fall inside the home work
 * window (default France 08:00-19:00) — the greyed cells are the slots where
 * a meeting with home colleagues is possible.
 */
export default function WorkOverlapStrip({ dateStr, lat, lng }: WorkOverlapStripProps) {
  const { t } = useTranslation()
  const homeTz = useSettingsStore(s => s.settings.home_timezone) || DEFAULT_HOME_TZ
  const workStart = useSettingsStore(s => s.settings.work_hours_start) ?? DEFAULT_WORK_START
  const workEnd = useSettingsStore(s => s.settings.work_hours_end) ?? DEFAULT_WORK_END

  const data = useMemo(() => {
    const tz = resolveDayTimezone(lat, lng)
    if (!tz) return null
    try {
      return computeWorkOverlap(dateStr, tz, { homeTz, workStart, workEnd })
    } catch {
      return null
    }
  }, [dateStr, lat, lng, homeTz, workStart, workEnd])

  if (!data) return null

  const fmtH = (h: number) => `${String(h).padStart(2, '0')}h`
  const offH = data.offsetMinutes / 60
  const offsetLabel = `${offH >= 0 ? '+' : '−'}${String(Math.abs(offH)).replace('.5', 'h30')}${Number.isInteger(offH) ? 'h' : ''}`

  return (
    <div>
      <div style={{ height: 1, background: 'var(--border-faint)', margin: '12px 0' }} />
      <div className="text-content-faint" style={{ fontSize: 'calc(11px * var(--fs-scale-caption, 1))', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
        <Briefcase size={12} strokeWidth={2} />
        {t('day.workOverlap')}
        <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>· {data.localTz} ({offsetLabel})</span>
      </div>
      <div style={{ overflowX: 'auto', margin: '0 -6px', padding: '0 6px 4px' }}>
        <div style={{ display: 'inline-flex', gap: 2 }}>
          {data.hours.map(h => (
            <div
              key={h.localHour}
              title={h.isWork ? `${fmtH(h.localHour)} = ${fmtH(h.homeHour)} ${data.homeTz}` : undefined}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                width: 44, padding: '5px 2px', borderRadius: 8,
                background: h.isWork ? 'var(--bg-secondary)' : 'transparent',
                opacity: h.isWork ? 1 : 0.4,
              }}
            >
              <span style={{ fontSize: 'calc(10px * var(--fs-scale-caption, 1))', fontWeight: 600, color: 'var(--text-primary)' }}>{fmtH(h.localHour)}</span>
              <span style={{ fontSize: 'calc(8px * var(--fs-scale-caption, 1))', color: h.isWork ? 'var(--text-muted)' : 'var(--text-faint)', fontWeight: 500 }}>
                {h.isWork ? `🏠 ${fmtH(h.homeHour)}` : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 'calc(10px * var(--fs-scale-caption, 1))', color: 'var(--text-faint)', marginTop: 4 }}>
        {data.overlap
          ? t('day.workOverlapHint', {
              homeRange: `${fmtH(data.overlap.homeStart)}–${fmtH(data.overlap.homeEnd)}`,
              localRange: `${fmtH(data.overlap.localStart)}–${fmtH(data.overlap.localEnd)}`,
            })
          : t('day.workOverlapNone')}
      </div>
    </div>
  )
}
