import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileAsync = promisify(execFile)

export const dynamic = 'force-dynamic'

const allowedHosts = ['tikwm.com','tiktok.com','tiktokcdn.com','tiktokcdn-us.com','tiktokv.com','byteimg.com','ibytedtos.com','v16-web.tiktok.com','v16-web-app.tiktok.com','v17-web.tiktok.com','v17-web-app.tiktok.com','v18-web.tiktok.com','v19-web.tiktok.com','v19-web-app.tiktok.com','v20-web.tiktok.com','v20-web-app.tiktok.com','v21-web.tiktok.com','v21-web-app.tiktok.com','v22-web.tiktok.com','musical.ly','cf-st.sc-cdn.net','bolt-gcdn.sc-cdn.net','sc-cdn.net']

function resolutionLabel(width: number, height: number): string {
  const shorter = Math.min(width, height)
  for (const std of [1080, 720, 576, 480, 360, 240]) { if (Math.abs(shorter - std) <= std * 0.1) return `${std}p` }
  return `${shorter}p`
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')?.trim()
  if (!url) return NextResponse.json({ error: 'Falta ?url=' }, { status: 400 })
  let parsed: URL
  try { parsed = new URL(url) } catch { return NextResponse.json({ error: 'URL inválida' }, { status: 400 }) }
  if (!allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) return NextResponse.json({ error: 'Host no permitido' }, { status: 403 })
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v','quiet','-print_format','json','-show_streams','-show_format','-headers',`User-Agent: Mozilla/5.0\r\nReferer: https://www.tiktok.com/\r\n`, url], { timeout: 15000, maxBuffer: 1024 * 1024 })
    const data = JSON.parse(stdout)
    const vs = (data.streams || []).find((s: any) => s.codec_type === 'video')
    if (!vs) return NextResponse.json({ error: 'No se encontró stream de video' }, { status: 404 })
    const w = vs.width ? Number(vs.width) : null, h = vs.height ? Number(vs.height) : null
    const fps = vs.r_frame_rate ? eval(vs.r_frame_rate) : null
    return NextResponse.json({ width: w, height: h, codec: vs.codec_name || null, bitrate: vs.bit_rate ? Number(vs.bit_rate) : null, fps: fps ? Math.round(fps * 100) / 100 : null, duration: vs.duration ? Number(vs.duration) : null, size: data.format?.size ? Number(data.format.size) : null, resolutionLabel: w && h ? resolutionLabel(w, h) : null })
  } catch (e: any) { return NextResponse.json({ error: `ffprobe falló: ${e.message?.slice(0, 200)}` }, { status: 500 }) }
}
