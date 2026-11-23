import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const allowedHosts = ['cf-st.sc-cdn.net','bolt-gcdn.sc-cdn.net','sc-cdn.net','v16-web.tiktok.com','v16-web-app.tiktok.com','v17-web.tiktok.com','v17-web-app.tiktok.com','v18-web.tiktok.com','v19-web.tiktok.com','v19-web-app.tiktok.com','v20-web.tiktok.com','v20-web-app.tiktok.com','v21-web.tiktok.com','v21-web-app.tiktok.com','v22-web.tiktok.com','tiktok.com','tiktokcdn.com','tiktokcdn-us.com','tiktokv.com','byteimg.com','ibytedtos.com','musical.ly','tikwm.com','cdninstagram.com','scontent.cdninstagram.com','video.cdninstagram.com','fbcdn.net','scontent.fbcdn.net','scontent-ak.fbcdn.net','instagram.com','rapidcdn.app','d.rapidcdn.app','snapsave.app']

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  const filename = req.nextUrl.searchParams.get('filename') || `snap_${Math.floor(Date.now() / 1000)}.bin`
  if (!url) return NextResponse.json({ error: 'Falta ?url=' }, { status: 400 })
  let parsed: URL
  try { parsed = new URL(url) } catch { return NextResponse.json({ error: 'URL inválida' }, { status: 400 }) }
  if (!allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) return NextResponse.json({ error: 'Host no permitido' }, { status: 403 })
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.snapchat.com/', Accept: '*/*' }, cache: 'no-store' })
    if (!r.ok) return NextResponse.json({ error: `CDN respondió ${r.status}` }, { status: 502 })
    const buf = Buffer.from(await r.arrayBuffer())
    return new NextResponse(new Uint8Array(buf), { status: 200, headers: { 'Content-Type': r.headers.get('content-type') || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${filename}"`, 'Content-Length': String(buf.length), 'Cache-Control': 'no-store' } })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }) }
}
