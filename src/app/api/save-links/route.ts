import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }) }
  if (!body.username || !Array.isArray(body.snaps)) return NextResponse.json({ error: 'Se requiere { username, snaps: [...] }' }, { status: 400 })
  const account = await db.snapchatAccount.upsert({ where: { username: body.username }, create: { username: body.username, lastScrapedAt: new Date() }, update: { lastScrapedAt: new Date() } })
  let newLinks = 0, duplicates = 0
  for (const snap of body.snaps) {
    try {
      await db.snapLink.create({ data: { accountId: account.id, snapId: snap.id, source: snap.source || 'currentStory', snapIndex: snap.snapIndex ?? null, timestampSec: snap.timestampSec || null, isoDate: snap.isoDate || null, expiresAtSec: snap.expiresAtSec || null, mediaType: snap.mediaType, originalUrl: snap.mediaUrl, previewUrl: snap.previewUrl || null } })
      newLinks++
    } catch {
      try { await db.snapLink.updateMany({ where: { originalUrl: snap.mediaUrl }, data: { snapIndex: snap.snapIndex ?? null, timestampSec: snap.timestampSec || null, isoDate: snap.isoDate || null, expiresAtSec: snap.expiresAtSec || null, mediaType: snap.mediaType, previewUrl: snap.previewUrl || null } }) } catch {}
      duplicates++
    }
  }
  return NextResponse.json({ ok: true, username: body.username, newLinks, duplicates, total: body.snaps.length })
}
