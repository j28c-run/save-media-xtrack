import { NextRequest, NextResponse } from 'next/server'
import { scrapeSnapchatProfile } from '@/lib/snapchat'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get('username')?.trim()
  if (!username) return NextResponse.json({ error: 'Falta ?username=' }, { status: 400 })
  try {
    const result = await scrapeSnapchatProfile(username)
    await db.snapchatAccount.upsert({
      where: { username },
      create: { username, displayName: result.displayName, followerCount: result.followerCount, lastScrapedAt: new Date() },
      update: { displayName: result.displayName, followerCount: result.followerCount, lastScrapedAt: new Date() },
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
