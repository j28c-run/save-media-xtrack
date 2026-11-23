import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { deleteSnapFile } from '@/lib/snapchat'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }) }
  if (!Array.isArray(body.linkIds) || !body.linkIds.length) return NextResponse.json({ error: 'Se requiere linkIds: [...]' }, { status: 400 })
  const links = await db.snapLink.findMany({ where: { id: { in: body.linkIds } } })
  let filesDeleted = 0, recordsDeleted = 0, notDownloaded = 0
  for (const link of links) {
    if (!link.localPath) { notDownloaded++; continue }
    if (deleteSnapFile(link.localPath)) filesDeleted++
    if (body.deleteRecord) { await db.snapLink.delete({ where: { id: link.id } }); recordsDeleted++ }
    else { await db.snapLink.update({ where: { id: link.id }, data: { localPath: null, fileSize: 0, fileDeletedAt: new Date() } }) }
  }
  return NextResponse.json({ ok: true, filesDeleted, recordsDeleted, notDownloaded, notFound: body.linkIds.length - links.length })
}
