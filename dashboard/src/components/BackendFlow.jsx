import { Handle, Position } from '@xyflow/react'
import { ago, num } from '../lib.js'

/* The backend as a flowchart: what the GCP server does, every minute, forever,
   plus how the dashboard reads it and how new code reaches the server. */

const TONE = {
  ok: 'border-live', bad: 'border-blocked', warn: 'border-manual', main: 'border-accent', quiet: 'border-line',
}

export function StepNode({ data }) {
  return (
    <div className={`w-[214px] rounded-xl border-2 bg-panel px-3.5 py-3 shadow-[0_2px_8px_rgb(0_0_0/.06)] ${TONE[data.tone || 'main']}`}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-accent" />
      <Handle type="target" id="top" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-accent" />
      <div className="flex items-baseline gap-2">
        {data.step && <span className="font-mono text-[10.5px] text-muted">{data.step}</span>}
        <span className="font-display text-[14.5px] font-bold leading-tight">{data.title}</span>
      </div>
      <p className="mt-1 text-[11.5px] leading-snug text-muted">{data.note}</p>
      {data.metric != null && (
        <div className="mt-2 flex items-baseline gap-1.5 border-t border-line pt-2">
          <span className="font-display text-[17px] font-bold leading-none tnum">{data.metric}</span>
          <span className="text-[11px] text-muted">{data.metricLabel}</span>
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-accent" />
      <Handle type="source" id="bottom" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-accent" />
    </div>
  )
}

export function DecisionNode({ data }) {
  return (
    <div className="relative flex h-[118px] w-[150px] items-center justify-center">
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-accent" style={{ left: 8 }} />
      <div className="absolute h-[84px] w-[84px] rotate-45 rounded-xl border-2 border-accent bg-panel shadow-[0_2px_8px_rgb(0_0_0/.06)]" />
      <div className="relative px-2 text-center">
        <div className="font-display text-[13.5px] font-bold leading-tight">{data.title}</div>
        {data.note && <div className="mt-0.5 text-[10.5px] leading-tight text-muted">{data.note}</div>}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-accent" style={{ right: 8 }} />
    </div>
  )
}

export function LaneNode({ data }) {
  return (
    <div className="h-full w-full rounded-2xl border border-dashed border-line bg-panel/40">
      <div className="px-4 pt-3 text-[11px] font-medium uppercase tracking-[.1em] text-muted">{data.label}</div>
      {data.sub && <div className="px-4 text-[11.5px] text-muted">{data.sub}</div>}
    </div>
  )
}

export const backendNodeTypes = { step: StepNode, decision: DecisionNode, lane: LaneNode }

export function buildBackendGraph(o, sources) {
  const p = o?.pipeline || {}
  const jobs = sources.reduce((n, s) => n + s.types.filter((t) => t.scheduled).length, 0)
  const blocked = sources.filter((s) => s.state === 'blocked' || s.state === 'error').length
  const nodes = []
  const edges = []
  const lane = (id, y, h, label, sub) => nodes.push({
    id, type: 'lane', position: { x: -40, y }, data: { label, sub }, draggable: false, selectable: false,
    style: { width: 2240, height: h }, zIndex: -1,
  })
  const step = (id, x, y, d) => nodes.push({ id, type: 'step', position: { x, y }, data: d })
  const decide = (id, x, y, d) => nodes.push({ id, type: 'decision', position: { x, y }, data: d })
  const edge = (id, a, b, state = 'stage', extra = {}) => edges.push({ id, source: a, target: b, type: 'flow', data: { state, weight: 2, dur: 2.2, ...extra.data }, ...extra.props })

  // Lane 1: the crawling loop
  lane('lane-loop', -70, 520, 'On the GCP server · runs forever', 'One container ("konu-crawler"); nothing here needs a person')
  step('timer', 0, 150, { step: '01', title: 'Timer', note: 'Wakes up every minute and looks at the schedule', metric: ago(o?.last_run), metricLabel: 'last run' })
  decide('due', 270, 135, { title: 'Any job due?', note: `${jobs || 45} jobs` })
  step('run', 470, 150, { step: '02', title: 'Run the crawl', note: 'Own process, hard stop after 20–30 min · each page gives up after 45 s', metric: num(o?.runs_24h), metricLabel: 'runs in 24 h' })
  decide('result', 740, 135, { title: 'How did it go?' })
  step('save', 950, 0, { step: '03', title: 'Save to database', note: 'New listing → added. Seen before → updated, never duplicated', tone: 'ok', metric: num(p.crawled), metricLabel: 'records stored' })
  step('backoff', 950, 170, { title: 'Website refused us', note: 'Blocked or needs a captcha: leave it alone, try again in 12 h', tone: 'bad', metric: num(blocked), metricLabel: 'websites waiting' })
  step('timeout', 950, 330, { title: 'Too slow', note: 'Stopped at the time limit so nothing hangs; retried next round', tone: 'warn' })
  step('details', 1230, 0, { step: '04', title: 'Details & cleaning', note: 'Opens new listing pages (20 min per round) and standardises values', metric: num(p.enriched), metricLabel: p.pending_details ? `done · ${num(p.pending_details)} queued` : 'done' })
  step('csv', 1510, 0, { step: '05', title: 'Rewrite the CSV', note: 'Written in one go, so it is never half-finished · optional copy to Cloud Storage', metric: num(p.in_csv), metricLabel: 'rows' })
  step('status', 1790, 0, { step: '06', title: 'Log the round', note: 'Run log and status.json, then back to the timer', tone: 'quiet' })

  edge('t-d', 'timer', 'due')
  edge('d-r', 'due', 'run', 'stage', { data: { label: 'yes' } })
  edge('r-x', 'run', 'result')
  edge('x-s', 'result', 'save', 'live', { data: { label: 'got data' } })
  edge('x-b', 'result', 'backoff', 'blocked', { data: { label: 'blocked' } })
  edge('x-t', 'result', 'timeout', 'manual', { data: { label: 'timed out' } })
  edge('s-de', 'save', 'details')
  edge('de-c', 'details', 'csv')
  edge('c-st', 'csv', 'status')

  // Lane 2: serving the dashboard
  lane('lane-serve', 500, 260, 'Serving this dashboard', 'Second container ("konu-api") reads the same database')
  step('api', 1230, 590, { title: 'Dashboard API', note: 'Reads the database · port 8000 · refuses requests without the secret key' })
  step('proxy', 1510, 590, { title: 'Vercel proxy', note: 'Adds the secret key on the server, so viewers never see it' })
  step('page', 1790, 590, { title: 'This page', note: 'Asks for fresh numbers every 30 seconds', tone: 'quiet' })
  // the API reads the same database the loop writes (drawn from the column above it, so no line crosses the branches)
  edge('s-api', 'details', 'api', 'stage', { props: { sourceHandle: 'bottom', targetHandle: 'top' }, data: { label: 'reads the database' } })
  edge('api-px', 'api', 'proxy')
  edge('px-pg', 'proxy', 'page')

  // Lane 3: shipping new code
  lane('lane-ci', 790, 250, 'When the code changes · GitHub Actions', 'Automatic once GCP_SA_KEY and GCP_PROJECT are added as GitHub secrets')
  step('merge', 0, 870, { title: 'Merge to main', note: 'A change is approved on GitHub', tone: 'quiet' })
  step('tests', 280, 870, { title: 'Run the tests', note: '69 checks against saved pages from every website' })
  step('build', 560, 870, { title: 'Build the image', note: 'The same Docker image the server runs, then a quick start-up check' })
  step('deploy', 840, 870, { title: 'Redeploy the server', note: 'Pulls the new code, rebuilds, restarts both containers · data is kept' })
  step('health', 1120, 870, { title: 'Health check', note: 'Waits until /api/health answers, else marks the deploy failed' })
  edge('m-t', 'merge', 'tests')
  edge('t-b', 'tests', 'build')
  edge('b-d', 'build', 'deploy')
  edge('d-h', 'deploy', 'health')
  return { nodes, edges }
}
