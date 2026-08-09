// The Costs sidebar breakdowns that read the itinerary-derived attribution:
// by country (with days), cost per day per country, and by month.
import { render, screen, waitFor } from '../../../tests/helpers/render'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../tests/helpers/msw/server'
import { useAuthStore } from '../../store/authStore'
import { useTripStore } from '../../store/tripStore'
import { resetAllStores, seedStore } from '../../../tests/helpers/store'
import { buildUser, buildTrip, buildBudgetItem } from '../../../tests/helpers/factories'
import CostsPanel from './CostsPanel'

const tripMembers = [{ id: 1, username: 'alice', avatar_url: null }]

const ITEMS = [
  { ...buildBudgetItem({ id: 1, trip_id: 1, category: 'lodging', name: 'Hotel Tokyo' }), total_price: 600, expense_date: '2027-03-02' },
  { ...buildBudgetItem({ id: 2, trip_id: 1, category: 'food', name: 'Ryokan Kyoto' }), total_price: 400, expense_date: '2027-03-10' },
  { ...buildBudgetItem({ id: 3, trip_id: 1, category: 'lodging', name: 'Hotel Seoul' }), total_price: 200, expense_date: '2027-04-05' },
  // No date of its own: only the server-derived attribution can place it.
  { ...buildBudgetItem({ id: 4, trip_id: 1, category: 'flights', name: 'Tokyo to Seoul' }), total_price: 300, expense_date: null },
]

const BREAKDOWN = {
  items: [
    { id: 1, country_code: 'JP', city: 'Tokyo', date: '2027-03-02' },
    { id: 2, country_code: 'JP', city: 'Kyoto', date: '2027-03-10' },
    { id: 3, country_code: 'KR', city: 'Seoul', date: '2027-04-05' },
    { id: 4, country_code: 'JP', city: 'Tokyo', date: '2027-03-31' },
  ],
  countries: [{ code: 'JP', days: 20 }, { code: 'KR', days: 4 }],
}

function mockApis(breakdown: unknown = BREAKDOWN) {
  server.use(
    http.get('/api/trips/1/budget', () => HttpResponse.json({ items: ITEMS })),
    http.get('/api/trips/1/budget/countries', () => HttpResponse.json(breakdown)),
    http.get('/api/trips/1/budget/settlement', () => HttpResponse.json({ balances: [], flows: [], settlements: [] })),
  )
}

beforeEach(() => {
  resetAllStores()
  seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true })
  seedStore(useTripStore, { trip: buildTrip({ id: 1, currency: 'EUR' }) })
})

describe('CostsPanel — country and month breakdowns', () => {
  it('shows the country of each expense with its city', async () => {
    mockApis()
    render(<CostsPanel tripId={1} tripMembers={tripMembers} />)

    await waitFor(() => expect(screen.getAllByText(/Japan · Tokyo/).length).toBeGreaterThan(0))
    expect(screen.getByText(/South Korea · Seoul/)).toBeInTheDocument()
  })

  it('falls back to the country alone when the city is not geocoded yet', async () => {
    mockApis({ ...BREAKDOWN, items: BREAKDOWN.items.map(i => ({ ...i, city: null })) })
    render(<CostsPanel tripId={1} tripMembers={tripMembers} />)

    await waitFor(() => expect(screen.getAllByText('Japan').length).toBeGreaterThan(0))
    expect(screen.queryByText(/Japan ·/)).not.toBeInTheDocument()
  })

  it('breaks the spend down by country with the days spent there', async () => {
    mockApis()
    const { container } = render(<CostsPanel tripId={1} tripMembers={tripMembers} />)

    // The day count sits in its own span, so assert on the card's text as a whole.
    const card = await waitFor(() => {
      const el = [...container.querySelectorAll('div')].find(d => d.textContent?.startsWith('By country'))
      if (!el) throw new Error('country card not rendered')
      return el
    })
    expect(card.textContent).toContain('Japan · 20 d')
    expect(card.textContent).toContain('South Korea · 4 d')
  })

  it('shows the cost per day for each country', async () => {
    mockApis()
    render(<CostsPanel tripId={1} tripMembers={tripMembers} />)

    // Japan: 600 + 400 + 300 = 1300 over 20 days = 65/day. Korea: 200 over 4 = 50/day.
    await screen.findByText('Cost per day')
    await waitFor(() => expect(screen.getAllByText(/65\s*€/).length).toBeGreaterThan(0))
  })

  it('totals the spend by month, including expenses with no date of their own', async () => {
    mockApis()
    render(<CostsPanel tripId={1} tripMembers={tripMembers} />)

    await screen.findByText('By month')
    // March holds the two dated Japan expenses plus the flight placed on 2027-03-31.
    await waitFor(() => expect(screen.getAllByText(/1[.,\s]?300\s*€/).length).toBeGreaterThan(0))
    expect(screen.getAllByText(/200\s*€/).length).toBeGreaterThan(0)
  })

  it('filters the ledger down to one country', async () => {
    mockApis()
    render(<CostsPanel tripId={1} tripMembers={tripMembers} />)

    await screen.findByText('Hotel Seoul')
    // The "By country" rows double as filters, and only exist once the
    // attribution has loaded.
    await screen.findByText('By country')
    const korea = screen.getAllByRole('button').filter(b => b.textContent?.includes('South Korea'))[0]
    await userEvent.click(korea)

    await waitFor(() => expect(screen.queryByText('Hotel Tokyo')).not.toBeInTheDocument())
    expect(screen.queryByText('Ryokan Kyoto')).not.toBeInTheDocument()
    expect(screen.getByText('Hotel Seoul')).toBeInTheDocument()
  })

  it('hides the country breakdowns entirely when the endpoint fails', async () => {
    server.use(
      http.get('/api/trips/1/budget', () => HttpResponse.json({ items: ITEMS })),
      http.get('/api/trips/1/budget/countries', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/trips/1/budget/settlement', () => HttpResponse.json({ balances: [], flows: [], settlements: [] })),
    )
    render(<CostsPanel tripId={1} tripMembers={tripMembers} />)

    await screen.findByText('Hotel Tokyo')
    expect(screen.queryByText('By country')).not.toBeInTheDocument()
    expect(screen.queryByText('Cost per day')).not.toBeInTheDocument()
  })
})
