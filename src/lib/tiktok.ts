/**
 * TikTok downloader: uses tikwm.com API.
 * Supports video, photo (carousel), and profiles.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileAsync = promisify(execFile)

export interface TiktokVideo {
  id: string; url: string
  videoUrl: string | null; noWatermarkUrl: string | null
  hdVideoUrl: string | null; hdNoWatermarkUrl: string | null
  images: string[] | null
  coverUrl: string | null; dynamicCoverUrl: string | null
  description: string | null
  author: { username: string | null; nickname: string | null; avatarUrl: string | null }
  stats: { diggCount: number | null; shareCount: number | null; commentCount: number | null; playCount: number | null }
  createTime: number | null; isoDate: string | null; duration: number | null
  size: number | null; hdSize: number | null
  kind: 'video' | 'photo'
}
export interface TiktokScrapeResult { type: 'video' | 'profile' | 'unknown'; videos: TiktokVideo[]; stats: { total: number } }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

async function fetchFromTikwm(tiktokUrl: string): Promise<any | null> {
  try { const r = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}&hd=1`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store' }); if (!r.ok) return null; const d = await r.json(); return d?.code === 0 ? d.data : null } catch { return null }
}

function mapTikwmItem(item: any, originalUrl: string): TiktokVideo {
  const isPhoto = Array.isArray(item.images) && item.images.length > 0
  return { id: String(item.id || ''), url: originalUrl, videoUrl: item.wmplay || item.play || null, noWatermarkUrl: item.play || null, hdVideoUrl: item.hdwmplay || null, hdNoWatermarkUrl: item.hdplay || null, images: isPhoto ? item.images : null, coverUrl: item.cover || null, dynamicCoverUrl: item.dynamic_cover || null, description: item.title || item.desc || null, author: { username: item.author?.unique_id || null, nickname: item.author?.nickname || null, avatarUrl: item.author?.avatar || null }, stats: { diggCount: item.digg_count ?? null, shareCount: item.share_count ?? null, commentCount: item.comment_count ?? null, playCount: item.play_count ?? null }, createTime: item.create_time ?? null, isoDate: item.create_time ? new Date(item.create_time * 1000).toISOString() : null, duration: item.duration ?? null, size: item.size ?? null, hdSize: item.hd_size ?? null, kind: isPhoto ? 'photo' : 'video' }
}

export async function scrapeTiktokUrl(rawUrl: string): Promise<TiktokScrapeResult> {
  let url = rawUrl.trim(); if (!url.startsWith('http')) url = 'https://' + url
  if (!/\/(video|photo)\/\d+/.test(url)) throw new Error('URL no válida. Pegá una URL de video o foto de TikTok.')
  const item = await fetchFromTikwm(url)
  if (!item) throw new Error('No se pudo obtener el contenido desde tikwm.')
  return { type: 'video', videos: [mapTikwmItem(item, url)], stats: { total: 1 } }
}

export async function scrapeTiktokProfile(profileUrl: string): Promise<TiktokScrapeResult> {
  let url = profileUrl.trim(); if (!url.startsWith('http')) url = 'https://' + url
  const username = url.match(/@([\w.-]+)/)?.[1]
  if (!username) throw new Error('No se pudo extraer el username.')
  const sessionId = `tt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  try {
    await execFileAsync('agent-browser', ['--session', sessionId, 'open', url], { timeout: 30000 })
    await execFileAsync('agent-browser', ['--session', sessionId, 'wait', '4000'], { timeout: 10000 })
    const { stdout } = await execFileAsync('agent-browser', ['--session', sessionId, 'eval', 'JSON.stringify(Array.from(document.querySelectorAll("a[href*=\\"/video/\\"], a[href*=\\"/photo/\\"]")).map(a => a.href))'], { timeout: 15000, maxBuffer: 1024 * 1024 })
    let videoUrls: string[] = []
    try { videoUrls = JSON.parse(stdout.trim().startsWith('"') ? JSON.parse(stdout) : stdout) } catch {}
    const uniqueUrls = Array.from(new Set(videoUrls)).slice(0, 30)
    if (!uniqueUrls.length) throw new Error('No se encontraron videos en el perfil.')
    const videos: TiktokVideo[] = []
    for (let i = 0; i < uniqueUrls.length; i += 5) {
      const results = await Promise.allSettled(uniqueUrls.slice(i, i + 5).map(u => fetchFromTikwm(u).then(item => item ? mapTikwmItem(item, u) : null)))
      for (const r of results) if (r.status === 'fulfilled' && r.value) videos.push(r.value)
    }
    return { type: 'profile', videos, stats: { total: videos.length } }
  } finally { try { await execFileAsync('agent-browser', ['--session', sessionId, 'close'], { timeout: 5000 }) } catch {} }
}
