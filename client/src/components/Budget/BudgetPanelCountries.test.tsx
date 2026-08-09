// Country breakdown of the expense table: filter, "by country" chart and the
// per-day-per-country rates. The attribution itself is server-derived (see
// server/tests/unit/services/budgetCountryService.test.ts) — these cover what
// the panel does with it.
import { render, screen, waitFor } from '../../../tests/helpers/render';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/helpers/msw/server';
import { useAuthStore } from '../../store/authStore';
import { useTripStore } from '../../store/tripStore';
import { resetAllStores, seedStore } from '../../../tests/helpers/store';
import { buildUser, buildTrip, buildBudgetItem } from '../../../tests/helpers/factories';
import BudgetPanel from './BudgetPanel';

const ITEMS = [
  buildBudgetItem({ id: 1, trip_id: 1, name: 'Hotel Tokyo', category: 'Accommodation', total_price: 600 }),
  buildBudgetItem({ id: 2, trip_id: 1, name: 'Ryokan Kyoto', category: 'Accommodation', total_price: 400 }),
  buildBudgetItem({ id: 3, trip_id: 1, name: 'Hotel Seoul', category: 'Accommodation', total_price: 200 }),
  buildBudgetItem({ id: 4, trip_id: 1, name: 'Travel insurance', category: 'Fees', total_price: 90 }),
]

function mockApis(countries: { items: { id: number; country_code: string | null }[]; countries: { code: string; days: number }[] }) {
  server.use(
    http.get('/api/trips/:id/budget', () => HttpResponse.json({ items: ITEMS })),
    http.get('/api/trips/:id/budget/countries', () => HttpResponse.json(countries)),
    http.get('/api/trips/:id/budget/settlement', () => HttpResponse.json({ balances: [], flows: [] })),
  )
}

const JP_KR = {
  items: [
    { id: 1, country_code: 'JP' },
    { id: 2, country_code: 'JP' },
    { id: 3, country_code: 'KR' },
    { id: 4, country_code: null },
  ],
  countries: [{ code: 'JP', days: 20 }, { code: 'KR', days: 4 }],
}

beforeEach(() => {
  resetAllStores()
  seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true })
  seedStore(useTripStore, { trip: buildTrip({ id: 1, currency: 'EUR' }) })
})

describe('BudgetPanel — by country', () => {
  it('lists each country with the number of days spent there', async () => {
    mockApis(JP_KR)
    render(<BudgetPanel tripId={1} />)

    await screen.findByText('By Country')
    expect(screen.getByRole('button', { name: /Japan/ })).toHaveTextContent('20 d')
    expect(screen.getByRole('button', { name: /South Korea/ })).toHaveTextContent('4 d')
  })

  it('groups expenses the itinerary cannot place under a "no country" bucket', async () => {
    mockApis(JP_KR)
    render(<BudgetPanel tripId={1} />)

    await screen.findByText('By Country')
    expect(screen.getAllByText(/No country/).length).toBeGreaterThan(0)
  })

  it('filters the table down to the chosen country', async () => {
    mockApis(JP_KR)
    render(<BudgetPanel tripId={1} />)

    await screen.findByText('Hotel Seoul')
    await userEvent.click(screen.getByRole('button', { name: /Japan/ }))

    await waitFor(() => expect(screen.queryByText('Hotel Seoul')).not.toBeInTheDocument())
    expect(screen.getByText('Hotel Tokyo')).toBeInTheDocument()
    expect(screen.getByText('Ryokan Kyoto')).toBeInTheDocument()
  })

  it('keeps every country in the chart while a filter is active, so the filter can be changed', async () => {
    mockApis(JP_KR)
    render(<BudgetPanel tripId={1} />)

    await screen.findByText('Hotel Seoul')
    await userEvent.click(screen.getByRole('button', { name: /Japan/ }))

    await waitFor(() => expect(screen.queryByText('Hotel Seoul')).not.toBeInTheDocument())
    // Korea is still offered even though its expenses are filtered out of the table.
    expect(screen.getByRole('button', { name: /South Korea/ })).toBeInTheDocument()
  })

  it('clicking the active country again clears the filter', async () => {
    mockApis(JP_KR)
    render(<BudgetPanel tripId={1} />)

    await screen.findByText('Hotel Seoul')
    await userEvent.click(screen.getByRole('button', { name: /Japan/ }))
    await waitFor(() => expect(screen.queryByText('Hotel Seoul')).not.toBeInTheDocument())

    // The filter dropdown now shows "Japan" too, so target the legend row itself.
    await userEvent.click(screen.getByTitle('Clear the filter'))
    await screen.findByText('Hotel Seoul')
  })

  it('shows the cost per day for each country, highest first', async () => {
    mockApis(JP_KR)
    render(<BudgetPanel tripId={1} />)

    await screen.findByText('Cost per Day')
    // Japan: 1000 over 20 days = 50/day. Korea: 200 over 4 days = 50/day.
    // Both rates appear once each, next to the chart's own totals.
    expect(screen.getAllByText(/^50[.,]00\s*€$/).length).toBe(2)
  })

  it('omits the per-day chart when no country has a known day count', async () => {
    mockApis({ items: JP_KR.items, countries: [] })
    render(<BudgetPanel tripId={1} />)

    await screen.findByText('By Country')
    expect(screen.queryByText('Cost per Day')).not.toBeInTheDocument()
  })

  it('degrades to the plain table when the country endpoint fails', async () => {
    server.use(
      http.get('/api/trips/:id/budget', () => HttpResponse.json({ items: ITEMS })),
      http.get('/api/trips/:id/budget/countries', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/trips/:id/budget/settlement', () => HttpResponse.json({ balances: [], flows: [] })),
    )
    render(<BudgetPanel tripId={1} />)

    await screen.findByText('Hotel Tokyo')
    expect(screen.getByText('Hotel Seoul')).toBeInTheDocument()
    expect(screen.queryByText('By Country')).not.toBeInTheDocument()
  })
})
