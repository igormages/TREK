import tzlookup from 'tz-lookup'

export const DEFAULT_HOME_TZ = 'Europe/Paris'
export const DEFAULT_WORK_START = 8
export const DEFAULT_WORK_END = 19
// Local waking window shown on the strip — meetings outside it are pointless.
export const AWAKE_START = 8
export const AWAKE_END = 23

export function resolveDayTimezone(lat?: number | null, lng?: number | null): string | null {
  if (lat == null || lng == null) return null
  try {
    return tzlookup(lat, lng)
  } catch {
    return null
  }
}

interface WallParts { y: number; mo: number; d: number; h: number; mi: number }

function wallPartsIn(tz: string, at: Date): WallParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  const parts: Record<string, string> = {}
  fmt.formatToParts(at).forEach(p => { parts[p.type] = p.value })
  // Some ICU builds emit "24" for midnight even with h23.
  const h = Number(parts.hour) === 24 ? 0 : Number(parts.hour)
  return { y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day), h, mi: Number(parts.minute) }
}

/**
 * UTC instant whose wall clock in `tz` reads `dateStr hour:00`.
 * Two correction passes so DST transitions around the target time still converge.
 */
export function zonedTimeToUtc(dateStr: string, hour: number, tz: string): Date {
  const desired = Date.parse(`${dateStr}T${String(hour).padStart(2, '0')}:00:00Z`)
  let ts = desired
  for (let i = 0; i < 2; i++) {
    const w = wallPartsIn(tz, new Date(ts))
    const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi)
    ts += desired - asUtc
  }
  return new Date(ts)
}

export interface OverlapHour {
  /** Wall hour at the destination, AWAKE_START..AWAKE_END on the day's date. */
  localHour: number
  /** Wall hour it corresponds to in the home timezone. */
  homeHour: number
  /** True when the home hour falls inside the home work window. */
  isWork: boolean
}

export interface WorkOverlap {
  localTz: string
  homeTz: string
  /** Destination minus home, in minutes, evaluated on the given date (DST-aware). */
  offsetMinutes: number
  hours: OverlapHour[]
  /** Contiguous meeting window, end bounds exclusive. Null when nothing lines up. */
  overlap: { localStart: number; localEnd: number; homeStart: number; homeEnd: number } | null
}

export interface WorkOverlapOptions {
  homeTz?: string
  workStart?: number
  workEnd?: number
}

export function computeWorkOverlap(dateStr: string, localTz: string, opts: WorkOverlapOptions = {}): WorkOverlap {
  const homeTz = opts.homeTz ?? DEFAULT_HOME_TZ
  const workStart = opts.workStart ?? DEFAULT_WORK_START
  const workEnd = opts.workEnd ?? DEFAULT_WORK_END

  const hours: OverlapHour[] = []
  for (let h = AWAKE_START; h <= AWAKE_END; h++) {
    const instant = zonedTimeToUtc(dateStr, h, localTz)
    const home = wallPartsIn(homeTz, instant)
    hours.push({ localHour: h, homeHour: home.h, isWork: home.h >= workStart && home.h < workEnd })
  }

  const noonHome = wallPartsIn(homeTz, zonedTimeToUtc(dateStr, 12, localTz))
  const offsetMinutes =
    (Date.parse(`${dateStr}T12:00:00Z`) - Date.UTC(noonHome.y, noonHome.mo - 1, noonHome.d, noonHome.h, noonHome.mi)) / 60000

  const work = hours.filter(x => x.isWork)
  const overlap = work.length
    ? {
        localStart: work[0].localHour,
        localEnd: work[work.length - 1].localHour + 1,
        homeStart: work[0].homeHour,
        homeEnd: work[work.length - 1].homeHour + 1,
      }
    : null

  return { localTz, homeTz, offsetMinutes, hours, overlap }
}
