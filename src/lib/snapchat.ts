/**
 * Snapchat scraper: fetches public profile, parses __NEXT_DATA__ or flight data,
 * and extracts all visible snaps (current story only).
 * Handles both old format (Next.js 12) and new format (Next.js 13+ RSC/flight data).
 * Extracts individual timestamps from the `mo` URL parameter (base64 protobuf).
 */
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

export type SnapSource = 'currentStory'

export interface SnapInfo {
  id: string
  source: SnapSource
  snapIndex: number | null
  timestampSec: number | null
  isoDate: string | null
  expiresAtSec: number | null
  expiresAtIso: string | null
  timeLeftSec: number | null
  mediaUrl: string
  previewUrl: string | null
  mediaType: 'mp4' | 'jpg' | 'bin'
}

export interface ScrapeResult {
  username: string
  displayName: string | null
  followerCount: string | null
  lastUpdated: string | null
  storyExpired: boolean
  snaps: SnapInfo[]
  stats: {
    total: number
    videos: number
    images: number
    expiringSoon: number
    expired: number
    byDay: Record<string, number>
  }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

function val(v: unknown): unknown {
  if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) return (v as Record<string, unknown>).value
  return v
}

function detectExt(url: string): 'mp4' | 'jpg' | 'bin' {
  if (/\.(27|1034|1322)\./.test(url)) return 'mp4'
  if (/\.(400|410|1023)\./.test(url)) return 'jpg'
  return 'bin'
}

function detectMediaType(snapMediaType: unknown, mediaUrl: string): 'mp4' | 'jpg' | 'bin' {
  const mt = val(snapMediaType)
  if (mt === 0 || mt === '0') return 'jpg'
  if (mt === 1 || mt === 2 || mt === '1' || mt === '2') return 'mp4'
  return detectExt(mediaUrl)
}

function isoFromTs(ts: number | null | undefined): string | null {
  if (!ts) return null
  try { return new Date(ts * 1000).toISOString() } catch { return null }
}

const NOW = () => Math.floor(Date.now() / 1000)
const EXPIRY_SEC = 24 * 3600

/** Decodes timestamp from the `mo` URL parameter (base64 protobuf with varint at field 1). */
function decodeMoTimestamp(moB64: string): number | null {
  try {
    let std = moB64.replace(/-/g, '+').replace(/_/g, '/').replace(/%3D/g, '=')
    const pad = std.length % 4
    if (pad) std += '='.repeat(4 - pad)
    const raw = Buffer.from(std, 'base64')
    for (let idx = 0; idx < raw.length - 2; idx++) {
      if (raw[idx] === 0x08) {
        let v = 0, shift = 0, pos = idx + 1
        while (pos < raw.length && shift < 35) {
          const b = raw[pos]; v |= (b & 0x7f) << shift; shift += 7; pos++
          if (!(b & 0x80)) break
        }
        if (v > 1700000000 && v < 1800000000) return v
      }
    }
    return null
  } catch { return null }
}

export async function scrapeSnapchatProfile(username: string): Promise<ScrapeResult> {
  const url = `https://www.snapchat.com/@${username}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'es-US,es;q=0.9,en;q=0.8' }, cache: 'no-store' })
  if (!res.ok) throw new Error(`Snapchat respondió ${res.status} para @${username}`)
  const html = await res.text()
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/)
  if (m) return parseNextData(m[1], username)
  return parseFlightData(html, username)
}

function parseNextData(jsonStr: string, username: string): ScrapeResult {
  const nextData = JSON.parse(jsonStr)
  const pp = nextData?.props?.pageProps
  if (!pp) throw new Error('pageProps no vino en __NEXT_DATA__')
  const nowSec = NOW()
  const snaps: SnapInfo[] = []
  const story = pp.story
  if (story?.snapList && Array.isArray(story.snapList)) {
    for (const s of story.snapList) {
      const ts = val(s.timestampInSec) as string | number | null
      const tsNum = ts ? Number(ts) : null
      const urls = s.snapUrls || {}
      const mediaUrl = urls.mediaUrl
      if (!mediaUrl) continue
      const id = (val(s.snapId) as string) || `snap_${tsNum || ''}_${snaps.length}`
      const expiresAtSec = tsNum ? tsNum + EXPIRY_SEC : null
      const snapIdxRaw = val(s.snapIndex)
      const snapIdx = snapIdxRaw !== null && snapIdxRaw !== undefined ? Number(snapIdxRaw) : null
      snaps.push({ id, source: 'currentStory', snapIndex: snapIdx, timestampSec: tsNum, isoDate: isoFromTs(tsNum), expiresAtSec, expiresAtIso: isoFromTs(expiresAtSec), timeLeftSec: expiresAtSec ? expiresAtSec - nowSec : null, mediaUrl, previewUrl: (val(urls.mediaPreviewUrl) as string) || null, mediaType: detectMediaType(s.snapMediaType, mediaUrl) })
    }
    snaps.sort((a, b) => {
      const ai = a.snapIndex ?? Number.MAX_SAFE_INTEGER, bi = b.snapIndex ?? Number.MAX_SAFE_INTEGER
      if (ai !== bi) return ai - bi
      const at = a.timestampSec ?? Number.MAX_SAFE_INTEGER, bt = b.timestampSec ?? Number.MAX_SAFE_INTEGER
      return at - bt
    })
  }
  const byDay: Record<string, number> = {}
  let videos = 0, images = 0, expiringSoon = 0, expired = 0
  for (const s of snaps) {
    if (s.mediaType === 'mp4') videos++
    else if (s.mediaType === 'jpg') images++
    if (s.isoDate) { const day = s.isoDate.slice(0, 10); byDay[day] = (byDay[day] || 0) + 1 }
    if (s.timeLeftSec !== null) { if (s.timeLeftSec < 0) expired++; else if (s.timeLeftSec < 6 * 3600) expiringSoon++ }
  }
  const userProfile = pp.userProfile || {}
  return { username, displayName: (val(userProfile.displayName) as string) || null, followerCount: (val(userProfile.followerCount) as string) || null, lastUpdated: pp.pageMetadata?.lastUpdated || null, storyExpired: Boolean(pp.showSnapExpiredToast), snaps, stats: { total: snaps.length, videos, images, expiringSoon, expired, byDay } }
}

function parseFlightData(html: string, username: string): ScrapeResult {
  const storyPattern = /kind\\\":\\\"story\\\".*?\\\"items\\\":\[(.*?)\]/g
  let firstStoryItems: string | null = null
  let m: RegExpExecArray | null
  while ((m = storyPattern.exec(html)) !== null) {
    const after = html.slice(m.index, m.index + m[0].length + 500)
    if (!/postedAtMs/.test(after)) { firstStoryItems = m[1]; break }
  }
  const snaps: SnapInfo[] = []
  let storyTimestampMs: number | null = null
  if (firstStoryItems) {
    const tsMatch = html.match(/postedAtMs\\":(\d+)/)
    if (tsMatch) storyTimestampMs = Number(tsMatch[1])
    const itemPattern = /\\"src\\":\\"(https:\/\/cf-st\.sc-cdn\.net\/d\/.*)\\"(?:[^}]*?\\"posterSrc\\":\\"(https:\/\/cf-st\.sc-cdn\.net\/d\/.*)\\")?/g
    let itemMatch: RegExpExecArray | null, i = 0
    while ((itemMatch = itemPattern.exec(firstStoryItems)) !== null) {
      const src = itemMatch[1].replace(/\\u0026/g, '&')
      const poster = itemMatch[2] ? itemMatch[2].replace(/\\u0026/g, '&') : null
      const isVideo = /\.(1034|1322)\./.test(src)
      let previewUrl = poster
      if (!previewUrl && isVideo) previewUrl = src.replace(/\.(1034|1322)\./, '.256.')
      if (!previewUrl && !isVideo) previewUrl = src
      let snapTsSec: number | null = null
      const moMatch = src.match(/mo=([^&]+)/)
      if (moMatch) snapTsSec = decodeMoTimestamp(moMatch[1])
      if (snapTsSec === null) snapTsSec = storyTimestampMs ? Math.floor(storyTimestampMs / 1000) : null
      const expiresAtSec = snapTsSec ? snapTsSec + EXPIRY_SEC : null
      snaps.push({ id: `snap_${i}_${src.match(/\/d\/([A-Za-z0-9_-]+)\./)?.[1]?.slice(0, 12) || i}`, source: 'currentStory', snapIndex: i, timestampSec: snapTsSec, isoDate: snapTsSec ? new Date(snapTsSec * 1000).toISOString() : null, expiresAtSec, expiresAtIso: expiresAtSec ? new Date(expiresAtSec * 1000).toISOString() : null, timeLeftSec: expiresAtSec ? expiresAtSec - NOW() : null, mediaUrl: src, previewUrl, mediaType: isVideo ? 'mp4' : 'jpg' })
      i++
    }
  }
  const byDay: Record<string, number> = {}
  let videos = 0, images = 0
  for (const s of snaps) { if (s.mediaType === 'mp4') videos++; else if (s.mediaType === 'jpg') images++ }
  const titleMatch = html.match(/<title>([^<]+)<\/title>/)
  return { username, displayName: titleMatch ? titleMatch[1].split('(')[0].trim() : null, followerCount: null, lastUpdated: null, storyExpired: snaps.length === 0, snaps, stats: { total: snaps.length, videos, images, expiringSoon: 0, expired: 0, byDay } }
}

export async function downloadSnap(username: string, snap: { mediaUrl: string; mediaType: string; isoDate?: string | null; timestampSec?: number | null }): Promise<{ relPath: string; absPath: string; size: number; mediaType: string }> {
  const day = snap.isoDate ? snap.isoDate.slice(0, 10) : 'unknown_date'
  const baseDir = path.join(process.cwd(), 'public', 'saved', username, day)
  fs.mkdirSync(baseDir, { recursive: true })
  const hash = crypto.createHash('sha256').update(snap.mediaUrl).digest('hex').slice(0, 16)
  const tsTag = snap.timestampSec ? String(snap.timestampSec) : 'nots'
  const fname = `snap_${tsTag}_${hash}.${snap.mediaType}`
  const absPath = path.join(baseDir, fname)
  const relPath = path.join('/saved', username, day, fname).replace(/\\/g, '/')
  if (fs.existsSync(absPath) && fs.statSync(absPath).size > 100) return { relPath, absPath, size: fs.statSync(absPath).size, mediaType: snap.mediaType }
  const r = await fetch(snap.mediaUrl, { headers: { 'User-Agent': UA, Referer: 'https://www.snapchat.com/', Accept: '*/*' } })
  if (!r.ok) throw new Error(`Descarga fallida (${r.status})`)
  const buf = Buffer.from(await r.arrayBuffer())
  fs.writeFileSync(absPath, buf)
  return { relPath, absPath, size: buf.length, mediaType: snap.mediaType }
}

export function deleteSnapFile(relPath: string): boolean {
  const absPath = path.join(process.cwd(), 'public', relPath)
  if (fs.existsSync(absPath)) { fs.unlinkSync(absPath); return true }
  return false
}
