// Vercel serverless proxy: browser → https://<app>.vercel.app/api/* → GCP backend.
// Keeps the backend's API key secret and avoids mixed-content (the VM serves plain HTTP).
// Set in Vercel → Settings → Environment Variables:
//   BACKEND_URL   e.g. http://34.93.12.34:8000   (the VM's external IP)
//   KONU_API_KEY  the same value as on the VM
export default async function handler(req, res) {
  const base = process.env.BACKEND_URL
  if (!base) {
    res.status(500).json({ detail: 'BACKEND_URL is not set in Vercel environment variables' })
    return
  }
  // Take the path from req.url: outside Next.js, Vercel does not fill req.query.path for [...path].js
  const incoming = new URL(req.url, 'http://localhost')
  const path = incoming.pathname.replace(/^\/api\/?/, '')
  const params = incoming.searchParams
  params.delete('path')
  params.delete('...path')
  const url = `${base.replace(/\/$/, '')}/api/${path}${params.toString() ? `?${params}` : ''}`
  try {
    const upstream = await fetch(url, {
      headers: { 'X-API-Key': process.env.KONU_API_KEY || '', Accept: req.headers.accept || '*/*' },
      signal: AbortSignal.timeout(25000),
    })
    res.status(upstream.status)
    for (const h of ['content-type', 'content-disposition']) {
      const v = upstream.headers.get(h)
      if (v) res.setHeader(h, v)
    }
    // Short CDN cache so many viewers don't each hit the VM; data changes every few minutes at most.
    res.setHeader('Cache-Control', path === 'export.csv' ? 'no-store' : 's-maxage=20, stale-while-revalidate=60')
    res.send(Buffer.from(await upstream.arrayBuffer()))
  } catch (e) {
    res.status(502).json({ detail: `Crawler server unreachable: ${e.message}` })
  }
}
