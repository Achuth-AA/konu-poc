import { useMemo, useState } from 'react'
import Activity from './components/Activity.jsx'
import Architecture from './components/Architecture.jsx'
import Header from './components/Header.jsx'
import Kpis from './components/Kpis.jsx'
import SourceDrawer from './components/SourceDrawer.jsx'
import { STATE, usePoll } from './lib.js'

export default function App() {
  const ov = usePoll('overview', null, 30000)
  const src = usePoll('sources', null, 30000)
  const sources = src.data?.sources || []
  const [sel, setSel] = useState(null)
  const [view, setView] = useState(() => (window.location.hash === '#backend' ? 'backend' : 'data'))
  const pick = (v) => { setView(v); setSel(null); window.history.replaceState(null, '', v === 'backend' ? '#backend' : '#') }
  const selected = sources.find((s) => s.name === sel)
  const titles = useMemo(() => Object.fromEntries(sources.map((s) => [s.name, s.title])), [sources])
  const counts = ['live', 'blocked', 'manual', 'pending'].map((k) => [k, sources.filter((s) => (s.state === 'error' ? 'blocked' : s.state) === k).length])

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <Header overview={ov.data} error={ov.error} at={ov.at} />
      <Kpis o={ov.data} />

      <section aria-labelledby="arch" className="min-w-0">
          <div className="mb-3 flex flex-wrap items-end gap-x-5 gap-y-3">
            <div className="mr-auto">
              <div role="tablist" aria-label="Diagram" className="mb-2 inline-flex rounded-lg border border-line bg-panel p-0.5 text-[13px]">
                {[['data', 'Data flow'], ['backend', 'Backend workflow']].map(([v, l]) => (
                  <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => pick(v)}
                    className={`rounded-md px-3.5 py-1.5 transition-colors duration-150 ease-out ${view === v ? 'bg-accent font-semibold text-paper' : 'text-muted hover:text-ink'}`}>{l}</button>
                ))}
              </div>
              <h2 id="arch" className="font-display text-xl font-bold">{view === 'backend' ? 'What the server does, step by step' : 'How the data flows'}</h2>
              <p className="text-[13px] text-muted">{view === 'backend'
                ? 'The crawling loop that runs on our Google Cloud server, how this page reads it, and how new code gets there.'
                : 'Each dot travelling on a line is data moving right now. Red lines are websites that refused our server.'}</p>
            </div>
            {view === 'data' && counts.filter(([, n]) => n).map(([k, n]) => (
              <span key={k} className="flex items-center gap-1.5 text-[12.5px]"><span className={`h-2 w-2 rounded-full ${STATE[k].dot}`} />{STATE[k].label} <b className="tnum">{n}</b></span>
            ))}
          </div>
          {src.error && <p className="mb-2 text-[13px] text-blocked">Couldn't load websites ({src.error.message}).</p>}
          {sources.length
            ? (
              <Architecture view={view} sources={sources} overview={ov.data} selected={sel} onSelect={(n) => setSel((c) => (c === n ? null : n))}>
                {selected && (
                  <div className="absolute bottom-3 right-3 top-14 z-10 w-[min(340px,calc(100%-24px))] overflow-y-auto">
                    <SourceDrawer source={selected} onClose={() => setSel(null)} />
                  </div>
                )}
              </Architecture>
            )
            : <div className="h-[560px] animate-pulse rounded-xl border border-line bg-panel md:h-[740px]" />}
      </section>

      <Activity titles={titles} />
    </div>
  )
}
