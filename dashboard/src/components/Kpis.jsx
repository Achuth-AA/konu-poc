import { inr, num } from '../lib.js'

/** The six numbers to read first, each with a one-line meaning in plain words. */
export default function Kpis({ o }) {
  const cards = [
    { label: 'Total records collected', value: num(o?.total_records), note: o ? `${num(o.listings)} listings · ${num(o.projects)} projects · ${num(o.government_records)} govt records` : 'Everything in the database' },
    { label: 'Listings in the table', value: num(o?.listings), note: 'Homes for sale or rent, one row each' },
    { label: 'New in the last 24 hours', value: num(o?.new_24h), note: 'Listings seen for the first time today' },
    { label: 'Websites working', value: o ? <>{o.sources_live}<span className="text-muted">/{o.sources_total}</span></> : '—', note: o ? `${o.sources_blocked} blocked · ${o.sources_manual} need a person` : '' },
    { label: 'Typical sale price', value: o?.median_sale_psf ? <>{inr(o.median_sale_psf, { short: false })}<span className="ml-1 text-base font-medium text-muted">/sq ft</span></> : '—', note: 'Median of homes for sale' },
    { label: 'Typical monthly rent', value: inr(o?.median_rent, { short: false }), note: 'Median of homes for rent' },
  ]
  return (
    <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((c, i) => (
        <div key={c.label} className={`rise rounded-xl border border-line bg-panel p-4 ${i === 0 ? 'border-accent/40' : ''}`} style={{ animationDelay: `${i * 40}ms` }}>
          <div className="text-[12.5px] text-muted">{c.label}</div>
          <div className="mt-1.5 font-display text-[30px] font-bold leading-none tnum">{c.value}</div>
          <div className="mt-2 text-[12px] leading-snug text-muted">{c.note}</div>
        </div>
      ))}
    </section>
  )
}
