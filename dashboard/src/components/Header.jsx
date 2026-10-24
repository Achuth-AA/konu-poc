import { DEMO, ago, apiUrl } from '../lib.js'

export default function Header({ overview, error, at }) {
  const ok = !error && overview
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line pb-5">
      <div className="flex items-center gap-3">
        <img src="/konu-logo.png" alt="Konu" width="44" height="44" className="rounded-xl border border-line bg-white" />
        <div className="text-[13px] leading-tight text-muted">Hyderabad<br />property data</div>
      </div>
      <div className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-[12.5px]" role="status" aria-live="polite">
        <span className={`h-2 w-2 rounded-full ${DEMO ? 'bg-manual' : ok ? 'bg-live breathe' : 'bg-blocked'}`} />
        {DEMO ? <span>Demo snapshot from the 24 Oct test run</span>
          : ok ? <span>Live · crawler last ran {ago(overview.last_run)} · page refreshed {ago(at?.toISOString())}</span>
          : <span>Can't reach the crawler server{error ? ` (${error.message})` : ''}</span>}
      </div>
      <a href={apiUrl('export.csv')} download="hyderabad_listings.csv"
        className="ml-auto inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-paper transition-transform duration-150 ease-out hover:opacity-90 active:scale-[.97]">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0 3.5-3.5M8 10 4.5 6.5M2.5 13.5h11" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Download the table (CSV)
      </a>
    </header>
  )
}
