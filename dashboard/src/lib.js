import { useCallback, useEffect, useRef, useState } from 'react'

// "/api" on Vercel is a serverless proxy to the GCP backend (see /api/[...path].js);
// in dev it is proxied by Vite to a local `python -m konu_crawlers serve`.
const API = import.meta.env.VITE_API_BASE || '/api'
export const DEMO = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')

export function apiUrl(path, params) {
  if (DEMO) return path.endsWith('.csv') ? '/demo/hyderabad_listings.csv' : `/demo/${path.replace(/\W+/g, '_')}.json`
  const q = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString() : ''
  return `${API}/${path}${q}`
}

export async function getJSON(path, params) {
  const res = await fetch(apiUrl(path, params), { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    let msg = `${res.status}`
    try { msg = (await res.json()).detail || msg } catch { /* not JSON */ }
    throw new Error(msg)
  }
  return res.json()
}

/** Fetch now and every `ms`; keeps the last good data while refreshing. */
export function usePoll(path, params, ms = 30000) {
  const [state, setState] = useState({ data: null, error: null, loading: true, at: null })
  const key = JSON.stringify([path, params])
  const timer = useRef()
  const load = useCallback(async () => {
    try {
      const data = await getJSON(path, params)
      setState({ data, error: null, loading: false, at: new Date() })
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => {
    load()
    if (DEMO || !ms) return undefined
    timer.current = setInterval(() => { if (!document.hidden) load() }, ms)
    return () => clearInterval(timer.current)
  }, [load, ms])
  return { ...state, reload: load }
}

const nf = new Intl.NumberFormat('en-IN')
export const num = (v) => (v == null || Number.isNaN(v) ? '—' : nf.format(Math.round(v)))

/** ₹ in the Indian way: 95 L, 1.45 Cr, 37,500. */
export function inr(v, { short = true } = {}) {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (short && n >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`
  if (short && n >= 1e5) return `₹${(n / 1e5).toFixed(1).replace(/\.0$/, '')} L`
  return `₹${nf.format(Math.round(n))}`
}

export function ago(iso) {
  if (!iso) return 'never'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

export const STATE = {
  live: { label: 'Working', dot: 'bg-live', text: 'text-live', stroke: 'rgb(var(--live))' },
  blocked: { label: 'Blocked', dot: 'bg-blocked', text: 'text-blocked', stroke: 'rgb(var(--blocked))' },
  error: { label: 'Failed last run', dot: 'bg-blocked', text: 'text-blocked', stroke: 'rgb(var(--blocked))' },
  manual: { label: 'Needs a person', dot: 'bg-manual', text: 'text-manual', stroke: 'rgb(var(--manual))' },
  pending: { label: 'Not run yet', dot: 'bg-muted', text: 'text-muted', stroke: 'rgb(var(--muted))' },
}
