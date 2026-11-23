import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { downloadSnap } from '@/lib/snapchat'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }) }
  if (!body.username) return NextResponse.json({ error: 'Falta username' }, { status: 400 })
  const account = await db.snapchatAccount.findUnique({ where: { username: body.username } })
  if (!account) return NextResponse.json({ error: `Cuenta @${body.username} no encontrada` }, { status: 404 })
  const toDownload = []
  if (body.linkIds?.length) {
    const links = await db.snapLink.findMany({ where: { accountId: account.id, id: { in: body.linkIds } } })
    for (const l of links) toDownload.push({ linkId: l.id, snap: { id: l.snapId || l.id, mediaType: l.mediaType, mediaUrl: l.originalUrl, previewUrl: l.previewUrl, isoDate: l.isoDate, timestampSec: l.timestampSec } })
  }
  if (body.snaps) for (const s of body.snaps) { const ex = await db.snapLink.findUnique({ where: { originalUrl: s.mediaUrl } }); toDownload.push({ linkId: ex?.id, snap: s }) }
  if (!toDownload.length) return NextResponse.json({ error: 'Nada que descargar' }, { status: 400 })
  const results = []; let saved = 0, exists = 0, failed = 0
  for (const item of toDownload) {
    try {
      const dl = await downloadSnap(body.username, item.snap)
      if (item.linkId) { await db.snapLink.update({ where: { id: item.linkId }, data: { localPath: dl.relPath, fileSize: dl.size, downloadedAt: new Date(), fileDeletedAt: null, mediaType: dl.mediaType } }); saved++ }
      else { const ex = await db.snapLink.findUnique({ where: { originalUrl: item.snap.mediaUrl } }); if (ex?.localPath) { exists++; } else { await db.snapLink.upsert({ where: { originalUrl: item.snap.mediaUrl }, create: { accountId: account.id, snapId: item.snap.id, mediaType: dl.mediaType, originalUrl: item.snap.mediaUrl, localPath: dl.relPath, fileSize: dl.size, downloadedAt: new Date() }, update: { localPath: dl.relPath, fileSize: dl.size, downloadedAt: new Date() } }); saved++ } }
      results.push({ snapId: item.snap.id, status: 'saved', relPath: dl.relPath, size: dl.size })
    } catch (e) { failed++; results.push({ snapId: item.snap.id, status: 'failed', error: e instanceof Error ? e.message : String(e) }) }
  }
  return NextResponse.json({ ok: true, saved, exists, failed, total: toDownload.length, results })
}
