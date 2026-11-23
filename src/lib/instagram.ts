import vm from 'vm'
import https from 'https'

export interface InstagramMedia { type: 'video' | 'image'; url: string; thumbnailUrl: string | null; quality: string | null }
export interface InstagramScrapeResult { originalUrl: string; author: string | null; description: string | null; coverUrl: string | null; media: InstagramMedia[]; stats: { total: number; videos: number; images: number } }

function fetchUrl(url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ ok: boolean; text: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: options.method || 'GET', headers: options.headers || {} }, (res) => {
      let body = ''; res.on('data', (c: Buffer) => (body += c.toString())); res.on('end', () => resolve({ ok: res.statusCode === 200, text: () => Promise.resolve(body) }))
    })
    req.on('error', reject); if (options.body) req.write(options.body); req.end()
  })
}

async function callSnapsave(igUrl: string): Promise<string> {
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2)
  const formData = `--${boundary}\r\nContent-Disposition: form-data; name="url"\r\n\r\n${igUrl}\r\n--${boundary}--`
  const res = await fetchUrl('https://snapsave.app/action.php?lang=en', { method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://snapsave.app/', Origin: 'https://snapsave.app' }, body: formData })
  const jsCode = await res.text()
  if (!jsCode.length) throw new Error('snapsave.app devolvió respuesta vacía')
  let decodedJs = ''; const htmlCaptures: string[] = []
  const sandbox = { eval: (code: string) => { decodedJs = code; try { vm.runInNewContext(code, { document: { getElementById: () => ({ set innerHTML(v: string) { htmlCaptures.push(v) }, get innerHTML() { return '' }, style: {}, className: '', remove: () => {}, classList: { add: () => {}, remove: () => {}, contains: () => false }, reset: () => {} }), querySelector: () => ({ style: {}, innerHTML: '', remove: () => {}, classList: { add: () => {}, remove: () => {} } }), querySelectorAll: () => [] }, setTimeout: () => {}, gtag: () => {}, window: { location: { hostname: 'snapsave.app' } }, location: { hostname: 'snapsave.app' }, Math, Date }, { timeout: 5000 }) } catch {} }, console: { log: () => {} } }
  try { vm.runInNewContext(jsCode, sandbox, { timeout: 5000 }) } catch {}
  if (decodedJs.includes('Unable to connect to Instagram server')) throw new Error('snapsave no pudo conectar a Instagram.')
  return htmlCaptures.join('\n') + '\n' + decodedJs
}

function parseMediaFromOutput(output: string): InstagramMedia[] {
  const media: InstagramMedia[] = []; const seen = new Set<string>()
  const v2Urls = output.match(/https:\/\/d\.rapidcdn\.app\/v2\?token=[A-Za-z0-9._-]+/g) || []
  const thumbUrls = output.match(/https:\/\/d\.rapidcdn\.app\/thumb\?token=[A-Za-z0-9._-]+/g) || []
  for (let i = 0; i < v2Urls.length; i++) { if (seen.has(v2Urls[i])) continue; seen.add(v2Urls[i]); media.push({ type: 'video', url: v2Urls[i], thumbnailUrl: thumbUrls[i] || null, quality: null }) }
  return media
}

export async function scrapeInstagramUrl(rawUrl: string): Promise<InstagramScrapeResult> {
  let url = rawUrl.trim(); if (!url.startsWith('http')) url = 'https://' + url
  const output = await callSnapsave(url)
  const media = parseMediaFromOutput(output)
  if (!media.length) throw new Error('No se encontraron medios descargables.')
  const videos = media.filter(m => m.type === 'video').length
  return { originalUrl: url, author: null, description: null, coverUrl: media[0]?.thumbnailUrl || null, media, stats: { total: media.length, videos, images: media.length - videos } }
}
