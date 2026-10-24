import { STATE, ago, num, usePoll } from '../lib.js'

/** What the crawler did most recently, newest first. */
export default function Activity({ titles }) {
  const { data, error } = usePoll('activity', { limit: 18 }, 30000)
  return (
    <section aria-labelledby="act" className="rounded-xl border border-line bg-panel p-5">
      <h2 id="act" className="font-display text-lg font-bold">Recent crawler runs</h2>
      <p className="text-[12.5px] text-muted">Each line is one visit to one website</p>
      <ol className="mt-3 grid min-h-[200px] gap-x-8 md:grid-cols-2 xl:grid-cols-3">
        {error && <li className="text-[13px] text-blocked">Couldn't load runs ({error.message}).</li>}
        {(data?.runs || []).map((r, i) => {
          const [src, type] = r.job.split(':')
          const st = STATE[r.state] || STATE.pending
          return (
            <li key={r.job + r.started + i} className="flex items-start gap-2.5 border-t border-line py-2.5 text-[13px]" title={r.reason}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
              <span className="min-w-0 flex-1">
                <b className="font-semibold">{titles[src] || src}</b> <span className="text-muted">{type.replace('_', ' ')}</span>
                <span className={`block truncate text-[12px] ${r.state === 'live' ? 'text-muted' : st.text}`}>{r.state === 'live' ? `${num(r.records)} records collected` : r.reason}</span>
              </span>
              <span className="shrink-0 text-[12px] text-muted">{ago(r.finished)}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
