import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const accounts = await db.snapchatAccount.findMany({ orderBy: { lastScrapedAt: 'desc' }, include: { snaps: { select: { id: true, isoDate: true, localPath: true } } } })
  return NextResponse.json({ accounts: accounts.map(a => ({ id: a.id, username: a.username, displayName: a.displayName, followerCount: a.followerCount, lastScrapedAt: a.lastScrapedAt, totalLinks: a.snaps.length, downloaded: a.snaps.filter(s => !!s.localPath).length, latestSnap: a.snaps.reduce((acc, s) => (!s.isoDate ? acc : !acc || s.isoDate > acc ? s.isoDate : acc), null) })) })
}
