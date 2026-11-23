import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get('username')?.trim()
  if (!username) {
    const accounts = await db.snapchatAccount.findMany({ orderBy: { lastScrapedAt: 'desc' }, include: { snaps: { select: { id: true, isoDate: true, mediaType: true, localPath: true, expiresAtSec: true } } } })
    return NextResponse.json({ accounts: accounts.map(a => ({ id: a.id, username: a.username, displayName: a.displayName, followerCount: a.followerCount, lastScrapedAt: a.lastScrapedAt, totalLinks: a.snaps.length, downloaded: a.snaps.filter(s => !!s.localPath).length, latestSnap: a.snaps.reduce((acc, s) => (!s.isoDate ? acc : !acc || s.isoDate > acc ? s.isoDate : acc), null) })) })
  }
  const account = await db.snapchatAccount.findUnique({ where: { username }, include: { snaps: { orderBy: { snapIndex: 'asc' } } } })
  if (!account) return NextResponse.json({ error: `Sin historial para @${username}` }, { status: 404 })
  const nowSec = Math.floor(Date.now() / 1000)
  const byDay = {}
  for (const s of account.snaps) {
    const day = s.isoDate ? s.isoDate.slice(0, 10) : 'unknown'
    if (!byDay[day]) byDay[day] = []
    byDay[day].push({ ...s, timeLeftSec: s.expiresAtSec ? s.expiresAtSec - nowSec : null })
  }
  return NextResponse.json({ account: { username: account.username, displayName: account.displayName, followerCount: account.followerCount, lastScrapedAt: account.lastScrapedAt }, stats: { totalLinks: account.snaps.length, downloaded: account.snaps.filter(s => !!s.localPath).length, expiringSoon: account.snaps.filter(s => s.expiresAtSec && s.expiresAtSec - nowSec > 0 && s.expiresAtSec - nowSec < 6 * 3600).length, expired: account.snaps.filter(s => s.expiresAtSec && s.expiresAtSec - nowSec < 0).length }, byDay })
}
