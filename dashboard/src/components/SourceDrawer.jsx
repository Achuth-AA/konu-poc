import { useEffect } from 'react'
import { STATE, ago, num } from '../lib.js'

const TYPE_LABEL = { sale: 'For sale', rent: 'For rent', projects: 'New projects', agents: 'Agents', builders: 'Builders', latest: 'Newest ads',
  layouts: 'Approved layouts', permissions: 'Building permissions', market_values: 'Market values', statistics: 'Registration statistics',
  land_records: 'Land records', prohibited: 'Prohibited land list' }

/** Everything about one website, written for someone who has never seen a crawler. */
export default function SourceDrawer({ source, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!source) return null
  const st = STATE[source.state] || STATE.pending
  return (
    <aside className="rise rounded-xl border border-line bg-panel p-5" aria-label={`${source.title} details`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${st.dot}`} />
        <div className="min-w-0">
          <h3 className="font-display text-lg font-bold leading-tight">{source.title}</h3>
          <a className="text-[12.5px] text-muted underline decoration-line underline-offset-2 hover:decoration-muted" href={`https://${source.site}`} target="_blank" rel="noreferrer">{source.site}</a>
        </div>
        <button type="button" onClick={onClose} className="ml-auto rounded-md px-2 py-1 text-[13px] text-muted hover:bg-paper" aria-label="Close">Close</button>
      </div>
      <p className="mt-3 text-[13.5px]">{source.what}</p>
      <p className={`mt-3 rounded-lg bg-paper px-3 py-2 text-[13px] ${st.text}`}><b className="font-semibold">{st.label}.</b> <span className="text-ink">{source.reason}</span></p>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div><dt className="text-[11px] text-muted">Stored</dt><dd className="font-display text-lg font-bold tnum">{num(source.total_records)}</dd></div>
        <div><dt className="text-[11px] text-muted">New today</dt><dd className="font-display text-lg font-bold tnum">{num(source.new_24h)}</dd></div>
        <div><dt className="text-[11px] text-muted">Last run</dt><dd className="font-display text-lg font-bold">{ago(source.last_run)}</dd></div>
      </dl>
      <table className="mt-4 w-full text-[12.5px]">
        <thead><tr className="text-left text-muted"><th className="pb-1 font-normal">What we read</th><th className="pb-1 font-normal">Status</th><th className="pb-1 text-right font-normal">Last run</th></tr></thead>
        <tbody>
          {source.types.map((t) => {
            const ts = STATE[t.state] || STATE.pending
            return (
              <tr key={t.type} className="border-t border-line" title={t.reason}>
                <td className="py-1.5">{TYPE_LABEL[t.type] || t.type}{t.every_hours ? <span className="text-muted"> · every {t.every_hours >= 24 ? `${t.every_hours / 24} d` : `${t.every_hours} h`}</span> : <span className="text-muted"> · by hand</span>}</td>
                <td className={`py-1.5 ${ts.text}`}>{ts.label}{t.state === 'live' ? ` · ${num(t.records)}` : ''}</td>
                <td className="py-1.5 text-right text-muted">{ago(t.last_run)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </aside>
  )
}
