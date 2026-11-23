import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }) }
  if (!body.sourceUrl) return NextResponse.json({ error: 'Falta sourceUrl' }, { status: 400 })
  const link = await db.tiktokLink.upsert({
    where: { sourceUrl: body.sourceUrl },
    create: { sourceUrl: body.sourceUrl, videoId: body.videoId || null, kind: body.kind || 'video', author: body.author || null, description: body.description || null, coverUrl: body.coverUrl || null, downloadUrl: body.downloadUrl || null, qualityLabel: body.qualityLabel || null, fileSize: body.fileSize || null, codec: body.codec || null, extractedAt: body.downloadUrl ? new Date() : null },
    update: { videoId: body.videoId || null, kind: body.kind || 'video', author: body.author || null, description: body.description || null, coverUrl: body.coverUrl || null, ...(body.downloadUrl ? { downloadUrl: body.downloadUrl, qualityLabel: body.qualityLabel || null, fileSize: body.fileSize || null, codec: body.codec || null, extractedAt: new Date() } : {}) },
  })
  return NextResponse.json({ ok: true, id: link.id })
}

export async function GET() {
  const links = await db.tiktokLink.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
  return NextResponse.json({ links })
}
