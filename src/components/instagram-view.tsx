'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { Download, Search, Film, Image as ImageIcon, Loader2, Play, Camera } from 'lucide-react'

interface InstagramMedia { type: 'video' | 'image'; url: string; thumbnailUrl: string | null; quality: string | null }
interface InstagramScrapeResult { originalUrl: string; author: string | null; description: string | null; coverUrl: string | null; media: InstagramMedia[]; stats: { total: number; videos: number; images: number } }

function buildDownloadUrl(mediaUrl: string, index: number, type: 'video' | 'image'): string {
  const ext = type === 'video' ? 'mp4' : 'jpg'
  return `/api/proxy?url=${encodeURIComponent(mediaUrl)}&filename=${encodeURIComponent(`instagram_${index + 1}.${ext}`)}`
}

export default function InstagramView() {
  const [url, setUrl] = useState('')
  const [results, setResults] = useState<InstagramScrapeResult[]>([])
  const [scraping, setScraping] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewType, setPreviewType] = useState<'video' | 'image'>('video')
  const { toast } = useToast()

  const scrape = useCallback(async (urlToScrape?: string) => {
    const rawInput = (urlToScrape || url).trim()
    if (!rawInput) { toast({ title: 'Falta la URL', variant: 'destructive' }); return }
    const urls = rawInput.split(/[\n\s]+/).map(u => u.trim()).filter(u => u.length > 0 && (u.includes('instagram.com') || u.startsWith('http')))
    if (!urls.length) { toast({ title: 'Sin URLs válidas', variant: 'destructive' }); return }
    setScraping(true); setResults([])
    const allResults: InstagramScrapeResult[] = []
    let successCount = 0, failCount = 0
    for (const targetUrl of urls) {
      try { const r = await fetch(`/api/ig-scrape?url=${encodeURIComponent(targetUrl)}`); const data = await r.json(); if (!r.ok) throw new Error(data.error); allResults.push(data); successCount++ }
      catch (e) { failCount++; allResults.push({ originalUrl: targetUrl, author: null, description: e instanceof Error ? e.message : 'Error', coverUrl: null, media: [], stats: { total: 0, videos: 0, images: 0 } }) }
    }
    setResults(allResults)
    toast({ title: `${allResults.reduce((a, r) => a + r.media.length, 0)} medios extraídos`, description: `${successCount} OK · ${failCount} fallidas` })
    setScraping(false)
  }, [url, toast])

  const totalMedia = results.reduce((a, r) => a + r.media.length, 0)

  return (
    <>
      <header className="border-b sticky top-0 z-20 bg-gradient-to-r from-purple-600 via-pink-500 to-amber-400">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center"><Camera className="w-5 h-5 text-white" /></div>
            <div><h1 className="text-lg font-extrabold text-white">Instagram Saver</h1><p className="text-xs text-white/80">Descarga reels, fotos y posts</p></div>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Camera className="w-4 h-4 text-purple-500" /> Pegá una o varias URLs</CardTitle>
            <CardDescription>Posts, reels y fotos. Una URL por línea.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-2">
              <Textarea value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); scrape() } }} placeholder="https://www.instagram.com/p/ABC/\nhttps://www.instagram.com/reel/DEF/" className="flex-1 min-h-[80px]" rows={3} />
              <Button onClick={() => scrape()} disabled={scraping || !url.trim()} className="bg-gradient-to-r from-purple-600 via-pink-500 to-amber-400 text-white">{scraping ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Extrayendo…</> : <><Search className="w-4 h-4 mr-2" /> Extraer</>}</Button>
            </div>
          </CardContent>
        </Card>
        {!results.length && !scraping && (<Card><CardContent className="py-12 text-center text-muted-foreground"><Camera className="w-10 h-10 mx-auto mb-3 opacity-40 text-purple-500" /><p className="text-sm">Pegá una URL y hacé clic en Extraer.</p></CardContent></Card>)}
        {results.length > 0 && (<>
          <Card className="mb-4"><CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
            <div><h2 className="text-lg font-bold">{totalMedia} medios</h2><p className="text-sm text-muted-foreground">{results.length} URLs</p></div>
            <div className="flex gap-2">
              <Badge variant="outline"><Film className="w-3 h-3 mr-1" /> {results.reduce((a, r) => a + r.stats.videos, 0)} videos</Badge>
              <Badge variant="outline"><ImageIcon className="w-3 h-3 mr-1" /> {results.reduce((a, r) => a + r.stats.images, 0)} imágenes</Badge>
            </div>
          </CardContent></Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {results.map((result, ri) => result.media.length > 0 ? result.media.map((media, mi) => (
              <InstagramMediaCard key={`${ri}-${mi}`} media={media} number={mi + 1} author={result.author} description={result.description} onPreview={() => { setPreviewUrl(media.url); setPreviewType(media.type) }} />
            )) : (<Card key={ri} className="border-red-300"><CardContent className="p-4"><p className="text-xs text-red-600 font-semibold">Error</p><p className="text-xs text-muted-foreground mt-1">{result.description}</p></CardContent></Card>))}
          </div>
        </>)}
      </main>
      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setPreviewUrl(null)}>
          <button className="absolute top-4 right-4 text-white text-2xl z-10" onClick={() => setPreviewUrl(null)}>×</button>
          {previewType === 'video' ? (
            <video src={`/api/proxy?url=${encodeURIComponent(previewUrl)}`} controls autoPlay className="max-h-[85vh] max-w-full rounded-lg" onClick={e => e.stopPropagation()} />
          ) : (
            <img src={`/api/proxy?url=${encodeURIComponent(previewUrl)}`} alt="preview" className="max-h-[85vh] max-w-full rounded-lg" onClick={e => e.stopPropagation()} />
          )}
        </div>
      )}
    </>
  )
}

function InstagramMediaCard({ media, number, author, description, onPreview }: { media: InstagramMedia; number: number; author: string | null; description: string | null; onPreview: () => void }) {
  const isVideo = media.type === 'video'
  return (
    <Card className="overflow-hidden group flex flex-row">
      <button onClick={onPreview} className="relative block w-28 flex-shrink-0 bg-black cursor-pointer" style={{ aspectRatio: '9/16' }} aria-label="Preview">
        {media.thumbnailUrl || media.url ? <img src={media.thumbnailUrl || media.url} alt="" className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center text-zinc-500">{isVideo ? <Film className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}</div>}
        <div className="absolute top-1 left-1 bg-black/70 text-white text-[10px] font-bold w-5 h-5 rounded flex items-center justify-center">{number}</div>
        <div className="absolute top-1 right-1 bg-black/70 text-white text-[9px] px-1 py-0.5 rounded">{isVideo ? 'VIDEO' : 'FOTO'}</div>
        {isVideo && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="bg-black/40 rounded-full p-2"><Play className="w-4 h-4 text-white fill-white" /></div></div>}
      </button>
      <CardContent className="p-2.5 flex-1 min-w-0 flex flex-col gap-1">
        {author && <div className="text-xs font-semibold truncate">@{author}</div>}
        {description && <p className="text-[11px] text-muted-foreground line-clamp-2">{description}</p>}
        <div className="flex gap-1 mt-auto">
          <Button asChild size="sm" className="h-6 text-[10px] px-2 bg-gradient-to-r from-purple-600 via-pink-500 to-amber-400 text-white"><a href={buildDownloadUrl(media.url, number - 1, media.type)} download><Download className="w-2.5 h-2.5 mr-0.5" /> {isVideo ? 'Video' : 'Foto'}</a></Button>
          {isVideo && <Button size="sm" variant="outline" onClick={onPreview} className="h-6 text-[10px] px-2"><Play className="w-2.5 h-2.5 mr-0.5" /> Play</Button>}
        </div>
      </CardContent>
    </Card>
  )
}
