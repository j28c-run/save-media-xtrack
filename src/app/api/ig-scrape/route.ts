import { NextRequest, NextResponse } from 'next/server'
import { scrapeInstagramUrl } from '@/lib/instagram'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')?.trim()
  if (!url) return NextResponse.json({ error: 'Falta ?url=' }, { status: 400 })
  try {
    const result = await scrapeInstagramUrl(url)
    return NextResponse.json(result)
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }) }
}
