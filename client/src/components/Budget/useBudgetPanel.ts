import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { useTripStore } from '../../store/tripStore'
import { useCanDo } from '../../store/permissionsStore'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'
import { budgetApi } from '../../api/client'
import type { BudgetItem } from '../../types'
import { currencyDecimals } from '../../utils/formatters'
import { widgetTheme, fmtNum, calcPP, calcPD, calcPPD, hasCustomMemberSplit, countryFlag, countryName } from './BudgetPanel.helpers'
import type { BudgetCountriesResponse } from '@trek/shared'
import { PIE_COLORS } from './BudgetPanel.constants'
import type { TripMember } from './BudgetPanelMemberChips'

function useIsDark(): boolean {
  const [dark, setDark] = useState<boolean>(() => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'))
  useEffect(() => {
    if (typeof document === 'undefined') return
    const mo = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])
  return dark
}

export interface EditingCat {
  name: string
  value: string
}

interface SettlementPerson {
  user_id: number
  username: string
  avatar_url: string | null
}

interface SettlementFlow {
  from: SettlementPerson
  to: SettlementPerson
  amount: number
}

interface SettlementBalance {
  user_id: number
  username: string
  avatar_url: string | null
  balance: number
}

export interface SettlementData {
  balances: SettlementBalance[]
  flows: SettlementFlow[]
}

export interface PieSegment {
  name: string
  value: number
  color: string
}

/**
 * One country of the trip, as shown by the "by country" chart and the filter.
 * `days` is the number of trip days spent there (server-derived from the
 * itinerary), so `perDay` is the real daily burn rate rather than an average
 * over the whole trip. `code` is null for expenses the itinerary can't place.
 */
export interface CountryStat {
  code: string | null
  label: string
  flag: string
  days: number
  value: number
  perDay: number | null
  color: string
}

/** Sentinel filter value for expenses with no resolvable country. */
export const NO_COUNTRY = '__none__'

export interface AddItemData {
  name: string
  total_price: number
  persons: number | null
  days: number | null
  note: string | null
  expense_date: string | null
}

export function useBudgetPanel(tripId: number, tripMembers: TripMember[]) {
  const { trip, budgetItems, addBudgetItem, updateBudgetItem, deleteBudgetItem, loadBudgetItems, updateTrip, setBudgetItemMembers, toggleBudgetMemberPaid, reorderBudgetItems, reorderBudgetCategories } = useTripStore()
  const can = useCanDo()
  const toast = useToast()
  const { t, locale } = useTranslation()
  const isDark = useIsDark()
  const theme = useMemo(() => widgetTheme(isDark), [isDark])
  const [newCategoryName, setNewCategoryName] = useState('')
  const [editingCat, setEditingCat] = useState<EditingCat | null>(null) // { name, value }
  const [settlement, setSettlement] = useState<SettlementData | null>(null)
  const [settlementOpen, setSettlementOpen] = useState(false)
  const currency = trip?.currency || 'EUR'
  const canEdit = can('budget_edit', trip)

  const fmt = (v: number | null | undefined, cur: string) => fmtNum(v, locale, cur)
  const hasMultipleMembers = tripMembers.length > 1

  // Drag state for categories
  const [dragCat, setDragCat] = useState<string | null>(null)
  const [dragOverCat, setDragOverCat] = useState<string | null>(null)
  // Drag state for items within a category
  const [dragItem, setDragItem] = useState<number | null>(null)
  const [dragOverItem, setDragOverItem] = useState<number | null>(null)
  const [dragItemCat, setDragItemCat] = useState<string | null>(null)

  // Load settlement data whenever budget items change
  useEffect(() => {
    if (!hasMultipleMembers) return
    budgetApi.settlement(tripId).then(setSettlement).catch(() => {})
  }, [tripId, budgetItems, hasMultipleMembers])

  // Country attribution comes from the itinerary, so it changes when expenses are
  // added/removed (new ids to place) — but not when only an amount is edited.
  const [countryData, setCountryData] = useState<BudgetCountriesResponse | null>(null)
  const [countryFilter, setCountryFilter] = useState<string>('')
  const itemIdKey = (budgetItems || []).map(i => i.id).join(',')
  useEffect(() => {
    if (!tripId) return
    let cancelled = false
    budgetApi.countries(tripId)
      .then(d => { if (!cancelled) setCountryData(d) })
      .catch(() => { if (!cancelled) setCountryData(null) })
    return () => { cancelled = true }
  }, [tripId, itemIdKey])

  const setCurrency = (cur: string) => {
    if (tripId) updateTrip(tripId, { currency: cur })
  }

  useEffect(() => { if (tripId) loadBudgetItems(tripId) }, [tripId])

  const itemCountry = useMemo(() => {
    const map = new Map<number, string | null>()
    for (const row of (countryData?.items || [])) map.set(row.id, row.country_code)
    return map
  }, [countryData])

  // The filter narrows the table, the category chart and the total; the country
  // charts below stay global so they keep working as the way back out of a filter.
  const visibleItems = useMemo(() => {
    const all = budgetItems || []
    if (!countryFilter) return all
    if (countryFilter === NO_COUNTRY) return all.filter(i => !itemCountry.get(i.id))
    return all.filter(i => itemCountry.get(i.id) === countryFilter)
  }, [budgetItems, countryFilter, itemCountry])

  const grouped = useMemo(() => {
    const map = new Map<string, BudgetItem[]>()
    for (const item of visibleItems) {
      const cat = item.category || 'Other'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(item)
    }
    return map
  }, [visibleItems])

  const categoryNames = Array.from(grouped.keys())

  // Stable color mapping: assign index-based colors once, never reassign on reorder
  const colorMapRef = useRef(new Map<string, string>())
  const categoryColor = useCallback((cat: string) => {
    const map = colorMapRef.current
    if (!map.has(cat)) {
      map.set(cat, PIE_COLORS[map.size % PIE_COLORS.length])
    }
    return map.get(cat)!
  }, [])
  const grandTotal = visibleItems.reduce((s, i) => s + (i.total_price || 0), 0)

  // Stable colour per country, assigned on first sight like the category colours.
  const countryColorRef = useRef(new Map<string, string>())
  const countryColor = useCallback((code: string) => {
    const map = countryColorRef.current
    if (!map.has(code)) map.set(code, PIE_COLORS[map.size % PIE_COLORS.length])
    return map.get(code)!
  }, [])

  const countryStats = useMemo<CountryStat[]>(() => {
    const totals = new Map<string | null, number>()
    for (const item of (budgetItems || [])) {
      const code = itemCountry.get(item.id) ?? null
      totals.set(code, (totals.get(code) || 0) + (item.total_price || 0))
    }
    const daysByCode = new Map((countryData?.countries || []).map(c => [c.code, c.days]))

    const stats: CountryStat[] = []
    for (const [code, value] of totals) {
      if (value <= 0) continue
      const days = code ? (daysByCode.get(code) || 0) : 0
      stats.push({
        code,
        label: code ? countryName(code, locale, code) : t('budget.noCountry'),
        flag: countryFlag(code),
        days,
        value,
        perDay: days > 0 ? value / days : null,
        // Concrete hex (not a CSS var): the donut derives a gradient from it via hexLighten.
        color: code ? countryColor(code) : '#9ca3af',
      })
    }
    // With no country resolved at all (endpoint down, itinerary not geolocated)
    // a lone "no country" slice says nothing — drop the whole breakdown instead.
    if (!stats.some(s => s.code)) return []
    // Unattributed last; the rest by spend so the chart legend reads top-down.
    return stats.sort((a, b) => (a.code === null ? 1 : b.code === null ? -1 : b.value - a.value))
  }, [budgetItems, itemCountry, countryData, locale, countryColor, t])

  const pieSegments = useMemo<PieSegment[]>(() =>
    categoryNames.map((cat, i) => ({
      name: cat,
      value: (grouped.get(cat) || []).reduce((s, x) => s + (x.total_price || 0), 0),
      color: categoryColor(cat),
    })).filter(s => s.value > 0)
  , [grouped, categoryNames])

  const handleAddItem = async (category: string, data: AddItemData) => { try { await addBudgetItem(tripId, { ...data, category }) } catch { toast.error(t('common.error')) } }
  const handleUpdateField = async (id: number, field: string, value: unknown) => { try { await updateBudgetItem(tripId, id, { [field]: value } as Partial<BudgetItem>) } catch { toast.error(t('common.error')) } }
  const handleDeleteItem = async (id: number) => { try { await deleteBudgetItem(tripId, id) } catch { toast.error(t('common.error')) } }
  const handleDeleteCategory = async (cat: string) => {
    const items = grouped.get(cat) || []
    try { for (const item of Array.from(items)) await deleteBudgetItem(tripId, item.id) }
    catch { toast.error(t('common.error')) }
  }
  const handleRenameCategory = async (oldName: string, newName: string) => {
    if (!newName.trim() || newName.trim() === oldName) return
    const items = grouped.get(oldName) || []
    try { for (const item of Array.from(items)) await updateBudgetItem(tripId, item.id, { category: newName.trim() }) }
    catch { toast.error(t('common.error')) }
  }
  const handleAddCategory = () => {
    if (!newCategoryName.trim()) return
    Promise.resolve(addBudgetItem(tripId, { name: t('budget.defaultEntry'), category: newCategoryName.trim(), total_price: 0 }))
      .catch(() => toast.error(t('common.error')))
    setNewCategoryName('')
  }

  const handleExportCsv = () => {
    const sep = ';'
    const esc = (v: unknown) => { const s = String(v ?? ''); return s.includes(sep) || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s }
    const d = currencyDecimals(currency)
    const fmtPrice = (v: number | null | undefined) => v != null ? v.toFixed(d) : ''

    const fmtDate = (iso: string) => { if (!iso) return ''; const d = new Date(iso + 'T00:00:00Z'); return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) }
    const header = ['Category', 'Country', 'Name', 'Date', 'Total (' + currency + ')', 'Persons', 'Days', 'Per Person', 'Per Day', 'Per Person/Day', 'Note']
    const rows = [header.join(sep)]

    for (const cat of categoryNames) {
      for (const item of (grouped.get(cat) || [])) {
        // A custom (uneven) split has no single per-person figure, so leave those columns blank (#1458).
        const customSplit = hasCustomMemberSplit(item)
        const pp = customSplit ? null : calcPP(item.total_price, item.persons)
        const pd = calcPD(item.total_price, item.days)
        const ppd = customSplit ? null : calcPPD(item.total_price, item.persons, item.days)
        const code = itemCountry.get(item.id) ?? null
        rows.push([
          esc(item.category), esc(code ? countryName(code, locale, code) : ''),
          esc(item.name), esc(fmtDate(item.expense_date || '')),
          fmtPrice(item.total_price), item.persons ?? '', item.days ?? '',
          fmtPrice(pp), fmtPrice(pd), fmtPrice(ppd),
          esc(item.note || ''),
        ].join(sep))
      }
    }

    const bom = '﻿'
    const blob = new Blob([bom + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeName = (trip?.title || 'trip').replace(/[^a-zA-Z0-9À-ɏ _-]/g, '').trim()
    a.download = `budget-${safeName}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const th: CSSProperties = { padding: '6px 8px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid var(--border-primary)', whiteSpace: 'nowrap', background: 'var(--bg-secondary)' }
  const td: CSSProperties = { padding: '2px 6px', borderBottom: '1px solid var(--border-secondary)', fontSize: 13, verticalAlign: 'middle', color: 'var(--text-primary)' }

  return {
    trip, budgetItems,
    setBudgetItemMembers, toggleBudgetMemberPaid, reorderBudgetItems, reorderBudgetCategories,
    t, locale, isDark, theme,
    newCategoryName, setNewCategoryName,
    editingCat, setEditingCat,
    settlement, settlementOpen, setSettlementOpen,
    currency, canEdit, fmt, hasMultipleMembers,
    dragCat, setDragCat, dragOverCat, setDragOverCat,
    dragItem, setDragItem, dragOverItem, setDragOverItem, dragItemCat, setDragItemCat,
    setCurrency,
    grouped, categoryNames, categoryColor, grandTotal, pieSegments,
    countryStats, countryFilter, setCountryFilter, itemCountry,
    handleAddItem, handleUpdateField, handleDeleteItem, handleDeleteCategory, handleRenameCategory, handleAddCategory, handleExportCsv,
    th, td,
  }
}
