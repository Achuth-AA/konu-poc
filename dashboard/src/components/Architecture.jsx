import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background, BaseEdge, BackgroundVariant, Controls, Handle, MiniMap, Panel, Position, ReactFlow,
  ReactFlowProvider, getBezierPath, useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { STATE, num } from '../lib.js'

const GROUPS = [
  ['Government', 'Government registers'],
  ['Listing portal', 'Listing portals'],
  ['Classifieds', 'Classifieds'],
]
const SRC_W = 236
const ROW = 58

/* ---------- edges: a faint wire plus particles travelling along it ---------- */

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 })
  const st = STATE[data?.state] || STATE.pending
  const live = data?.state === 'live' || data?.state === 'stage'
  const color = data?.state === 'stage' ? 'rgb(var(--accent))' : st.stroke
  const dots = live ? Math.max(1, Math.min(4, data?.weight || 2)) : 0
  const dur = data?.dur || 2.6
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: color, strokeOpacity: live ? 0.35 : 0.3, strokeWidth: live ? 1.6 : 1.2, strokeDasharray: live ? undefined : '4 6' }} />
      {Array.from({ length: dots }).map((_, i) => (
        <circle key={i} r={data?.state === 'stage' ? 3.2 : 2.6} fill={color} className="particle">
          <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`${(-dur * i) / dots}s`} path={path} calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.4 0 0.6 1" />
        </circle>
      ))}
      {!live && data?.state !== 'pending' && (
        <g transform={`translate(${(sourceX + targetX) / 2 - 60}, ${sourceY + (targetY - sourceY) * 0.18})`} opacity="0.85">
          <circle r="7" fill="rgb(var(--panel))" stroke={color} strokeWidth="1.2" />
          {data?.state === 'manual'
            ? <path d="M0 -3.2v3.6M0 2.6v.6" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
            : <path d="M-2.6 -2.6l5.2 5.2M2.6 -2.6l-5.2 5.2" stroke={color} strokeWidth="1.6" strokeLinecap="round" />}
        </g>
      )}
    </>
  )
}

/* ---------- nodes ---------- */

function SourceNode({ data, selected }) {
  const st = STATE[data.state] || STATE.pending
  return (
    <div className={`flex w-[236px] items-center gap-2.5 rounded-xl border bg-panel px-3 py-2.5 shadow-[0_1px_2px_rgb(0_0_0/.06)] transition-[border-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-px ${selected ? 'border-ink shadow-[0_0_0_3px_rgb(var(--accent)/.18)]' : 'border-line hover:border-muted'}`}>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${st.dot} ${data.state === 'live' ? 'breathe' : ''}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold leading-tight">{data.short}</div>
        <div className="truncate text-[11px] leading-tight text-muted">{data.site}</div>
      </div>
      <span className={`shrink-0 font-mono text-[11px] tnum ${data.state === 'live' ? 'text-ink' : st.text}`}>
        {data.state === 'live' ? num(data.total_records) : data.state === 'manual' ? 'manual' : data.state === 'pending' ? 'queued' : 'blocked'}
      </span>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-line" />
    </div>
  )
}

function StageNode({ data, selected }) {
  const shapes = { round: 'rounded-full', db: 'rounded-[50%/22%]', card: 'rounded-2xl' }
  return (
    <div className="flex flex-col items-center text-center" style={{ width: data.w || 168 }}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-accent" style={{ top: (data.size || 104) / 2 }} />
      <div className={`flex flex-col items-center justify-center border-2 bg-panel shadow-[0_2px_8px_rgb(0_0_0/.06)] transition-[box-shadow] duration-150 ease-out ${shapes[data.shape || 'card']} ${data.tone === 'muted' ? 'border-line' : 'border-accent'} ${selected ? 'shadow-[0_0_0_4px_rgb(var(--accent)/.18)]' : ''}`}
        style={{ width: data.size || 104, height: data.size || 104 }}>
        <span className="font-display text-[24px] font-bold leading-none tnum">{data.big}</span>
        <span className="mt-1 px-2 text-[10.5px] leading-tight text-muted">{data.unit}</span>
      </div>
      <div className="mt-2.5 font-display text-[15px] font-bold leading-tight">{data.title}</div>
      <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{data.note}</div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-accent" style={{ top: (data.size || 104) / 2 }} />
    </div>
  )
}

function GroupLabel({ data }) {
  return <div className="w-[236px] border-b border-line pb-1 text-[11px] font-medium uppercase tracking-[.1em] text-muted">{data.label} <span className="normal-case tracking-normal">· {data.count}</span></div>
}

const nodeTypes = { source: SourceNode, stage: StageNode, label: GroupLabel }
const edgeTypes = { flow: FlowEdge }

/* ---------- graph ---------- */

function shortTitle(s) {
  return s.title.replace(/\s*\(.*\)$/, '').replace(' (Telangana RERA)', '')
}

function buildGraph(sources, o) {
  const nodes = []
  const edges = []
  // Two input columns (like a network's input layer): government + classifieds, and portals.
  const columns = [[GROUPS[0], GROUPS[2]], [GROUPS[1]]]
  let maxY = 0
  columns.forEach((groups, ci) => {
    let y = 0
    for (const [g, label] of groups) {
      const items = sources.filter((s) => s.group === g)
      if (!items.length) continue
      nodes.push({ id: `lbl-${g}`, type: 'label', position: { x: ci * 280, y }, data: { label, count: items.length }, selectable: false, draggable: false })
      y += 30
      for (const s of items) {
        nodes.push({ id: s.name, type: 'source', position: { x: ci * 280, y }, data: { ...s, short: shortTitle(s) } })
        y += ROW
      }
      y += 34
    }
    maxY = Math.max(maxY, y)
  })
  const y = maxY
  const mid = y / 2 - 70
  const p = o?.pipeline || {}
  const X = { crawler: 660, kinds: 940, clean: 1210, db: 1470, out: 1750, dash: 2010 }
  const stage = (id, x, yy, d) => nodes.push({ id, type: 'stage', position: { x, y: yy }, data: d })
  stage('crawler', X.crawler, mid, { title: 'Crawler', big: num(o?.runs_24h), unit: 'website visits in 24 h', note: 'Google Cloud, Mumbai · runs on timers', shape: 'round', size: 118, w: 190 })
  stage('k-listings', X.kinds, mid - 210, { title: 'Listings', big: num(o?.listings), unit: 'homes for sale / rent', note: 'One per advertised home' })
  stage('k-projects', X.kinds, mid, { title: 'New projects', big: num(o?.projects), unit: 'builder projects', note: 'Price ranges, builders' })
  stage('k-gov', X.kinds, mid + 210, { title: 'Govt registers', big: num(o?.government_records), unit: 'layouts & permissions', note: 'HMDA and other registers' })
  stage('clean', X.clean, mid - 210, { title: 'Cleaning', big: num(p.enriched), unit: 'listings enriched', note: p.pending_details ? `${num(p.pending_details)} still to open` : 'Floor, facing, parking, age…' })
  stage('db', X.db, mid, { title: 'Database', big: num(p.crawled), unit: 'records stored', note: 'Updated, never duplicated', shape: 'db', size: 118, w: 190 })
  stage('csv', X.out, mid - 130, { title: 'Your CSV table', big: num(p.in_csv), unit: 'rows · 30 columns', note: 'Download from the top right' })
  stage('api', X.out, mid + 130, { title: 'Dashboard API', big: '30 s', unit: 'refresh interval', note: 'Feeds this page', tone: 'muted' })
  stage('dash', X.dash, mid + 130, { title: 'This dashboard', big: '●', unit: 'live', note: 'Vercel', tone: 'muted' })

  for (const s of sources) {
    const weight = s.state === 'live' ? Math.ceil(Math.log10((s.total_records || 0) + 10)) : 0
    edges.push({ id: `e-${s.name}`, source: s.name, target: 'crawler', type: 'flow', data: { state: s.state, weight, dur: 2.2 + (s.name.length % 5) * 0.25 } })
  }
  const st = (id, a, b, weight = 3, dur = 2.4) => edges.push({ id, source: a, target: b, type: 'flow', data: { state: 'stage', weight, dur } })
  st('c-l', 'crawler', 'k-listings'); st('c-p', 'crawler', 'k-projects', 2); st('c-g', 'crawler', 'k-gov', 2)
  st('l-c', 'k-listings', 'clean'); st('c-d', 'clean', 'db'); st('p-d', 'k-projects', 'db', 2); st('g-d', 'k-gov', 'db', 2)
  st('d-csv', 'db', 'csv'); st('d-api', 'db', 'api', 2); st('api-dash', 'api', 'dash', 2, 1.8)
  return { nodes, edges }
}

function Canvas({ sources, overview, selected, onSelect }) {
  const { nodes, edges } = useMemo(() => buildGraph(sources, overview), [sources, overview])
  const rf = useReactFlow()
  const first = useRef(true)
  useEffect(() => {
    if (first.current && nodes.length) {
      first.current = false
      requestAnimationFrame(() => rf.fitView({ padding: 0.04, duration: 0 }))
    }
  }, [nodes.length, rf])
  const styled = useMemo(() => nodes.map((n) => ({ ...n, selected: n.id === selected })), [nodes, selected])
  const onNodeClick = useCallback((_, n) => { if (n.type === 'source') onSelect(n.id) }, [onSelect])
  const mini = useCallback((n) => (n.type === 'source' ? (STATE[n.data.state] || STATE.pending).stroke : n.type === 'stage' ? 'rgb(var(--accent))' : 'transparent'), [])

  return (
    <ReactFlow nodes={styled} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      onNodeClick={onNodeClick} onPaneClick={() => onSelect(null)}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
      zoomOnScroll={false} zoomOnPinch panOnScroll={false} preventScrolling={false} zoomOnDoubleClick
      minZoom={0.1} maxZoom={2.2} proOptions={{ hideAttribution: true }} fitView fitViewOptions={{ padding: 0.04 }}>
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="rgb(var(--muted) / .35)" />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap pannable zoomable nodeColor={mini} nodeStrokeWidth={0} maskColor="rgb(var(--paper) / .7)" style={{ width: 168, height: 104 }} className="!hidden md:!block" />
      <Panel position="top-left" className="!m-3 hidden rounded-lg md:block border border-line bg-panel/90 px-3 py-1.5 text-[11.5px] text-muted backdrop-blur">
        Drag to move · pinch or <kbd className="font-mono">Ctrl</kbd>+scroll to zoom · click a website
      </Panel>
    </ReactFlow>
  )
}

export default function Architecture(props) {
  const wrap = useRef(null)
  const [full, setFull] = useState(false)
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === wrap.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggle = () => (document.fullscreenElement ? document.exitFullscreen() : wrap.current?.requestFullscreen?.())?.catch?.(() => {})
  return (
    <div ref={wrap} className={`relative overflow-hidden rounded-xl border border-line bg-paper ${full ? 'h-screen' : 'h-[440px] md:h-[740px]'}`}>
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
      <button type="button" onClick={toggle}
        className="absolute right-3 top-3 z-10 rounded-lg border border-line bg-panel/90 px-3 py-1.5 text-[12px] font-medium backdrop-blur transition-transform duration-150 ease-out active:scale-[.97]">
        {full ? 'Exit full screen' : 'Full screen'}
      </button>
      {props.children}
    </div>
  )
}

