import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const links = await db.tiktokLink.findMany({ orderBy: { createdAt: 'desc' }, take: 500 })
  const byAuthor = {}
  for (const l of links) { const a = l.author || 'sin autor'; if (!byAuthor[a]) byAuthor[a] = { count: 0, latestUrl: l.sourceUrl, latestCover: l.coverUrl, latestDate: l.createdAt.toISOString() }; byAuthor[a].count++ }
  const byDay = {}
  for (const l of links) { const d = l.createdAt.toISOString().slice(0, 10); if (!byDay[d]) byDay[d] = []; byDay[d].push(l) }
  return NextResponse.json({ total: links.length, byAuthor: Object.entries(byAuthor).map(([author, info]) => ({ author, ...info })), byDay })
}
