'use client'

import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import {
  Download,
  Search,
  Film,
  Image as ImageIcon,
  Loader2,
  ExternalLink,
  Heart,
  Share2,
  MessageCircle,
  Play,
  Music2,
  Clock,
  Sparkles,
  History,
  Calendar,
} from 'lucide-react'

interface TiktokVideo {
  id: string
  url: string
  videoUrl: string | null
  noWatermarkUrl: string | null
  hdVideoUrl: string | null
  hdNoWatermarkUrl: string | null
  images: string[] | null
  coverUrl: string | null
  dynamicCoverUrl: string | null
  description: string | null
  author: {
    username: string | null
    nickname: string | null
    avatarUrl: string | null
  }
  stats: {
    diggCount: number | null
    shareCount: number | null
    commentCount: number | null
    playCount: number | null
  }
  createTime: number | null
  isoDate: string | null
  duration: number | null
  size: number | null
  hdSize: number | null
  kind: 'video' | 'photo'
}

interface VideoInfo {
  width: number | null
  height: number | null
  codec: string | null
  bitrate: number | null
  fps: number | null
  duration: number | null
  size: number | null
  resolutionLabel: string | null
}

interface TiktokScrapeResult {
  type: 'video' | 'profile' | 'unknown'
  videos: TiktokVideo[]
  stats: { total: number }
}

interface TiktokHistoryLink {
  id: string
  sourceUrl: string
  videoId: string | null
  kind: string
  author: string | null
  description: string | null
  coverUrl: string | null
  createdAt: string
  downloadUrl: string | null
  qualityLabel: string | null
  fileSize: number | null
  codec: string | null
  extractedAt: string | null
}

interface TiktokHistoryResult {
  total: number
  byAuthor: Array<{
    author: string
    count: number
    latestUrl: string
    latestCover: string | null
    latestDate: string
  }>
  byDay: Record<string, TiktokHistoryLink[]>
}

function fmtNumber(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function fmtDuration(sec: number | null | undefined): string {
  if (!sec) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtSize(bytes: number | null | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function buildDownloadUrl(mediaUrl: string, videoId: string, kind: 'video' | 'image', index?: number): string {
  const suffix = kind === 'image' && index !== undefined ? `_${index + 1}` : ''
  const ext = kind === 'image' ? 'jpg' : 'mp4'
  const filename = `tiktok_${videoId}${suffix}.${ext}`
  return `/api/proxy?url=${encodeURIComponent(mediaUrl)}&filename=${encodeURIComponent(filename)}`
}

function fmtDayLabel(day: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  if (day === today) return 'Hoy'
  if (day === y) return 'Ayer'
  try {
    const d = new Date(day + 'T00:00:00')
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' })
  } catch {
    return day
  }
}

function pickBestQuality(video: TiktokVideo): {
  url: string | null
  label: string
  size: number | null
} {
  if (video.hdNoWatermarkUrl) return { url: video.hdNoWatermarkUrl, label: 'HD sin marca', size: video.hdSize }
  if (video.hdVideoUrl) return { url: video.hdVideoUrl, label: 'HD', size: video.hdSize }
  if (video.noWatermarkUrl) return { url: video.noWatermarkUrl, label: 'sin marca', size: video.size }
  if (video.videoUrl) return { url: video.videoUrl, label: 'normal', size: video.size }
  return { url: null, label: '—', size: null }
}

export default function TiktokView() {
  const [url, setUrl] = useState('')
  const [result, setResult] = useState<TiktokScrapeResult | null>(null)
  const [scraping, setScraping] = useState(false)
  const [history, setHistory] = useState<TiktokHistoryResult | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [previewVideo, setPreviewVideo] = useState<TiktokVideo | null>(null)
  const [previewHistoryLink, setPreviewHistoryLink] = useState<TiktokHistoryLink | null>(null)
  const { toast } = useToast()

  const scrape = useCallback(async (urlToScrape?: string) => {
    const rawInput = (urlToScrape || url).trim()
    if (!rawInput) { toast({ title: 'Falta la URL', variant: 'destructive' }); return }
    const urls = rawInput.split(/[\n\s]+/).map(u => u.trim()).filter(u => u.length > 0)
    if (!urls.length) { toast({ title: 'Sin URLs válidas', variant: 'destructive' }); return }
    setScraping(true); setResult(null)
    if (urls.length === 1) {
      const targetUrl = urls[0].startsWith('@') ? `https://www.tiktok.com/${urls[0]}` : urls[0].startsWith('http') ? urls[0] : `https://${urls[0]}`
      try {
        const r = await fetch(`/api/tiktok-scrape?url=${encodeURIComponent(targetUrl)}`)
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Falló el scrapeo')
        setResult(data)
        if (data.videos.length === 0) { toast({ title: 'Sin videos' }) }
        else {
          toast({ title: `${data.videos.length} videos encontrados`, description: data.type === 'profile' ? 'Perfil' : 'Video' })
          for (const v of data.videos) {
            const best = pickBestQuality(v)
            await fetch('/api/tiktok-save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceUrl: v.url, videoId: v.id, kind: v.kind, author: v.author.username, description: v.description, coverUrl: v.coverUrl, downloadUrl: best.url, qualityLabel: best.label, fileSize: best.size }) }).catch(() => {})
          }
          loadHistory()
        }
      } catch (e) { toast({ title: 'Error', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }) }
      finally { setScraping(false) }
      return
    }
    toast({ title: `Procesando ${urls.length} URLs` })
    const allVideos: TiktokVideo[] = []
    let successCount = 0, failCount = 0
    for (let i = 0; i < urls.length; i++) {
      let targetUrl = urls[i]
      if (targetUrl.startsWith('@')) targetUrl = `https://www.tiktok.com/${targetUrl}`
      else if (!targetUrl.startsWith('http')) targetUrl = `https://${targetUrl}`
      try {
        const r = await fetch(`/api/tiktok-scrape?url=${encodeURIComponent(targetUrl)}`)
        const data = await r.json()
        if (!r.ok) throw new Error(data.error)
        if (data.videos?.length > 0) {
          allVideos.push(...data.videos); successCount++
          for (const v of data.videos) {
            const best = pickBestQuality(v)
            await fetch('/api/tiktok-save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceUrl: v.url, videoId: v.id, kind: v.kind, author: v.author.username, description: v.description, coverUrl: v.coverUrl, downloadUrl: best.url, qualityLabel: best.label, fileSize: best.size }) }).catch(() => {})
          }
        }
      } catch { failCount++ }
    }
    setResult({ type: 'video', videos: allVideos, stats: { total: allVideos.length } })
    toast({ title: `${allVideos.length} videos extraídos`, description: `${successCount} OK · ${failCount} fallidas` })
    loadHistory(); setScraping(false)
  }, [url, toast])

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    try { const r = await fetch('/api/tiktok-history'); const data = await r.json(); if (r.ok) setHistory(data) } catch {}
    finally { setLoadingHistory(false) }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])
  const historyDays = history ? Object.keys(history.byDay).sort().reverse() : []

  return (
    <>
      <header className="border-b border-zinc-200 bg-black sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-pink-500 via-cyan-400 to-white flex items-center justify-center"><Music2 className="w-5 h-5 text-black" /></div>
            <div><h1 className="text-lg font-extrabold text-white">TikTok Saver</h1><p className="text-xs text-zinc-400">Sin marca de agua · mejor calidad</p></div>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        {history && history.byAuthor.length > 0 && (
          <Card className="mb-4 border-zinc-300 bg-zinc-50">
            <CardContent className="p-3">
              <p className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-pink-500" /> ACCESOS DIRECTOS</p>
              <div className="flex flex-wrap gap-1.5">
                {history.byAuthor.slice(0, 10).map(a => (
                  <Button key={a.author} size="sm" variant="outline" onClick={() => scrape(`https://www.tiktok.com/@${a.author}`)} className="h-7 text-xs">@{a.author} <span className="opacity-60 ml-1">{a.count}</span></Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Music2 className="w-4 h-4 text-pink-500" /> Pegá una o varias URLs</CardTitle>
            <CardDescription>Mejor calidad sin marca de agua. Una URL por línea.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-2">
              <Textarea value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); scrape() } }} placeholder="https://www.tiktok.com/@usuario/video/123" className="flex-1 min-h-[80px]" rows={3} />
              <Button onClick={() => scrape()} disabled={scraping || !url.trim()} className="bg-black text-white hover:bg-zinc-800">{scraping ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Extrayendo…</> : <><Search className="w-4 h-4 mr-2" /> Extraer</>}</Button>
            </div>
          </CardContent>
        </Card>
        <Tabs defaultValue="current" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="current"><Film className="w-4 h-4 mr-2" /> Extraído {result ? `(${result.videos.length})` : ''}</TabsTrigger>
            <TabsTrigger value="history"><History className="w-4 h-4 mr-2" /> Historial {history ? `(${history.total})` : ''}</TabsTrigger>
          </TabsList>
          <TabsContent value="current" className="space-y-4">
            {!result && !scraping && (<Card><CardContent className="py-12 text-center text-muted-foreground"><Music2 className="w-10 h-10 mx-auto mb-3 opacity-40 text-pink-500" /><p className="text-sm">Pegá una URL de TikTok y hacé clic en Extraer.</p></CardContent></Card>)}
            {result && (<>
              <Card><CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
                <div><h2 className="text-lg font-bold">{result.type === 'profile' ? 'Perfil' : 'Video'}</h2><p className="text-sm text-muted-foreground">{result.videos.length} encontrados</p></div>
                <Badge variant="outline"><Film className="w-3 h-3 mr-1" /> {result.stats.total}</Badge>
              </CardContent></Card>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {result.videos.map((video, i) => <TiktokVideoCard key={video.id || i} video={video} number={i + 1} onPreview={() => setPreviewVideo(video)} />)}
              </div>
            </>)}
          </TabsContent>
          <TabsContent value="history" className="space-y-4">
            {loadingHistory && !history && (<Card><CardContent className="py-12 text-center"><Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" /><p className="text-sm">Cargando historial…</p></CardContent></Card>)}
            {!loadingHistory && (!history || history.total === 0) && (<Card><CardContent className="py-12 text-center text-muted-foreground"><History className="w-10 h-10 mx-auto mb-3 opacity-40" /><p className="text-sm">Sin enlaces guardados.</p></CardContent></Card>)}
            {history && history.total > 0 && (<>
              <Card><CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-lg font-bold">Historial</h2>
                <div className="flex gap-3 text-center"><div><div className="text-xl font-bold">{history.total}</div><div className="text-[10px] text-muted-foreground">enlaces</div></div><div><div className="text-xl font-bold text-pink-600">{history.byAuthor.length}</div><div className="text-[10px] text-muted-foreground">autores</div></div></div>
              </CardContent></Card>
              {historyDays.map(day => (
                <div key={day} className="bg-white rounded-xl border border-zinc-200 shadow-md overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 bg-zinc-50 border-b border-zinc-100"><Calendar className="w-4 h-4 text-zinc-500" /><h3 className="font-bold text-sm">{fmtDayLabel(day)}</h3><Badge variant="secondary" className="text-xs">{history.byDay[day].length}</Badge></div>
                  <div className="p-4"><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {history.byDay[day].map((link, i) => <TiktokHistoryCard key={link.id} link={link} number={i + 1} onReScrape={() => scrape(link.sourceUrl)} onPreview={() => setPreviewHistoryLink(link)} />)}
                  </div></div>
                </div>
              ))}
            </>)}
          </TabsContent>
        </Tabs>
      </main>
      <Dialog open={!!previewVideo} onOpenChange={o => !o && setPreviewVideo(null)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden gap-0">
          <DialogHeader className="p-3 border-b border-zinc-100 flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-sm">{previewVideo?.author.username && `@${previewVideo.author.username}`}</DialogTitle>
          </DialogHeader>
          {previewVideo && previewVideo.kind === 'video' && (() => {
            const best = pickBestQuality(previewVideo)
            return best.url ? <div className="bg-black flex items-center justify-center max-h-[70vh]"><video src={`/api/proxy?url=${encodeURIComponent(best.url)}`} controls autoPlay className="max-h-[70vh] max-w-full" /></div> : <div className="p-6 text-center text-muted-foreground">No hay URL disponible</div>
          })()}
          {previewVideo && previewVideo.kind === 'photo' && previewVideo.images && <div className="bg-black p-4 max-h-[70vh] overflow-y-auto"><div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{previewVideo.images.map((img, i) => <img key={i} src={img} alt={`Imagen ${i + 1}`} className="w-full h-auto rounded" />)}</div></div>}
          {previewVideo && <div className="p-3 border-t border-zinc-100 bg-white flex flex-wrap gap-2">
            {(() => { const best = pickBestQuality(previewVideo); return best.url && previewVideo.kind === 'video' ? <Button asChild size="sm" className="bg-black text-white"><a href={buildDownloadUrl(best.url, previewVideo.id, 'video')} download><Download className="w-3.5 h-3.5 mr-1.5" /> Descargar ({best.label})</a></Button> : null })()}
            <Button asChild size="sm" variant="outline"><a href={previewVideo.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5 mr-1.5" /> TikTok</a></Button>
          </div>}
        </DialogContent>
      </Dialog>
      <Dialog open={!!previewHistoryLink} onOpenChange={o => !o && setPreviewHistoryLink(null)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden gap-0">
          <DialogHeader className="p-3 border-b border-zinc-100 flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-sm">{previewHistoryLink?.author && `@${previewHistoryLink.author}`}</DialogTitle>
          </DialogHeader>
          {previewHistoryLink?.downloadUrl ? <div className="bg-black flex items-center justify-center max-h-[70vh]"><video src={`/api/proxy?url=${encodeURIComponent(previewHistoryLink.downloadUrl)}`} controls autoPlay className="max-h-[70vh] max-w-full" /></div> : <div className="p-6 text-center text-muted-foreground"><p className="text-sm">Sin URL guardada.</p></div>}
          {previewHistoryLink?.downloadUrl && <div className="p-3 border-t border-zinc-100 bg-white flex flex-wrap gap-2">
            <Button asChild size="sm" className="bg-black text-white"><a href={buildDownloadUrl(previewHistoryLink.downloadUrl, previewHistoryLink.videoId || previewHistoryLink.id, 'video')} download><Download className="w-3.5 h-3.5 mr-1.5" /> Descargar</a></Button>
            <Button asChild size="sm" variant="outline"><a href={previewHistoryLink.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5 mr-1.5" /> TikTok</a></Button>
          </div>}
        </DialogContent>
      </Dialog>
    </>
  )
}

function TiktokVideoCard({ video, number, onPreview }: { video: TiktokVideo; number: number; onPreview: () => void }) {
  const isPhoto = video.kind === 'photo' && video.images && video.images.length > 0
  const best = pickBestQuality(video)
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState(false)
  useEffect(() => {
    if (isPhoto || !best.url) return
    let cancelled = false
    setInfoLoading(true)
    fetch(`/api/video-info?url=${encodeURIComponent(best.url)}`).then(r => r.ok ? r.json() : null).then(data => { if (!cancelled && data && !data.error) { setVideoInfo(data); } }).catch(() => {}).finally(() => { if (!cancelled) setInfoLoading(false) })
    return () => { cancelled = true }
  }, [best.url, isPhoto])
  return (
    <Card className="overflow-hidden group flex flex-row">
      <button onClick={onPreview} className="relative block w-28 flex-shrink-0 bg-black cursor-pointer" style={{ aspectRatio: '9/16' }} aria-label="Reproducir">
        {video.coverUrl ? <img src={video.coverUrl} alt={video.description || ''} className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center text-zinc-500"><Film className="w-6 h-6" /></div>}
        <div className="absolute top-1 left-1 bg-black/70 text-white text-[10px] font-bold w-5 h-5 rounded flex items-center justify-center">{number}</div>
        <div className="absolute top-1 right-1 bg-black/70 text-white text-[9px] px-1 py-0.5 rounded">{isPhoto ? `FOTO×${video.images?.length || 1}` : 'V'}</div>
        {!isPhoto && best.url && <div className="absolute bottom-1 left-1 bg-pink-500 text-white text-[9px] font-semibold px-1 py-0.5 rounded">{videoInfo?.resolutionLabel || (infoLoading ? '…' : best.label)}</div>}
        {video.duration && !isPhoto && <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1 py-0.5 rounded">{fmtDuration(video.duration)}</div>}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="bg-black/40 rounded-full p-2"><Play className="w-4 h-4 text-white fill-white" /></div></div>
      </button>
      <CardContent className="p-2.5 flex-1 min-w-0 flex flex-col gap-1.5">
        {video.author.username && <div className="flex items-center gap-1.5">{video.author.avatarUrl && <img src={video.author.avatarUrl} alt="" className="w-4 h-4 rounded-full" />}<span className="text-xs font-semibold truncate">@{video.author.username}</span></div>}
        {video.description && <p className="text-[11px] text-muted-foreground line-clamp-2">{video.description}</p>}
        {!isPhoto && <div className="text-[10px] text-zinc-600 bg-zinc-100 rounded px-1.5 py-1">{videoInfo ? <><span className="font-semibold text-pink-600">{videoInfo.resolutionLabel}</span><span className="text-zinc-400 mx-1">·</span><span>{videoInfo.codec}</span></> : infoLoading ? <span className="text-zinc-400">Analizando…</span> : <span className="text-zinc-400">{best.label}</span>}</div>}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
          {video.stats.playCount !== null && <span><Play className="w-2.5 h-2.5 inline" /> {fmtNumber(video.stats.playCount)}</span>}
          {video.stats.diggCount !== null && <span><Heart className="w-2.5 h-2.5 inline" /> {fmtNumber(video.stats.diggCount)}</span>}
          {video.stats.commentCount !== null && <span><MessageCircle className="w-2.5 h-2.5 inline" /> {fmtNumber(video.stats.commentCount)}</span>}
        </div>
        <div className="text-[10px] text-muted-foreground">{fmtDate(video.isoDate)}</div>
        <div className="flex gap-1 mt-auto flex-wrap">
          {isPhoto ? video.images!.map((imgUrl, i) => <Button key={i} asChild size="sm" variant="outline" className="h-6 text-[10px] px-1.5"><a href={buildDownloadUrl(imgUrl, video.id, 'image', i)} download><Download className="w-2.5 h-2.5" /> {i + 1}</a></Button>) : best.url && <Button asChild size="sm" className="h-6 text-[10px] px-2 bg-black text-white"><a href={buildDownloadUrl(best.url, video.id, 'video')} download><Download className="w-2.5 h-2.5" /> {videoInfo?.resolutionLabel || best.label}</a></Button>}
          <Button size="sm" variant="outline" onClick={onPreview} className="h-6 text-[10px] px-2"><Play className="w-2.5 h-2.5" /> Play</Button>
          <Button asChild size="sm" variant="ghost" className="h-6 text-[10px] px-2"><a href={video.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-2.5 h-2.5" /></a></Button>
        </div>
      </CardContent>
    </Card>
  )
}

function TiktokHistoryCard({ link, number, onReScrape, onPreview }: { link: TiktokHistoryLink; number: number; onReScrape: () => void; onPreview: () => void }) {
  const hasDownloadUrl = !!link.downloadUrl
  const videoId = link.videoId || link.id
  return (
    <Card className="overflow-hidden group flex flex-row">
      <button onClick={onPreview} className="relative block w-24 flex-shrink-0 bg-black cursor-pointer" style={{ aspectRatio: '9/16' }} aria-label="Preview">
        {link.coverUrl ? <img src={link.coverUrl} alt="" className="w-full h-full object-cover opacity-80 group-hover:opacity-100" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center text-zinc-500">{link.kind === 'photo' ? <ImageIcon className="w-6 h-6" /> : <Film className="w-6 h-6" />}</div>}
        <div className="absolute top-1 left-1 bg-black/70 text-white text-[10px] font-bold w-5 h-5 rounded flex items-center justify-center">{number}</div>
        <div className="absolute top-1 right-1 bg-black/70 text-white text-[9px] px-1 py-0.5 rounded">{link.kind === 'photo' ? 'FOTO' : 'V'}</div>
        {hasDownloadUrl && link.qualityLabel && <div className="absolute bottom-1 left-1 bg-pink-500 text-white text-[9px] font-semibold px-1 py-0.5 rounded">{link.qualityLabel}</div>}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="bg-black/40 rounded-full p-2">{hasDownloadUrl ? <Play className="w-4 h-4 text-white fill-white" /> : <Search className="w-3 h-3 text-white" />}</div></div>
      </button>
      <CardContent className="p-2.5 flex-1 min-w-0 flex flex-col gap-1">
        {link.author && <div className="text-xs font-semibold truncate">@{link.author}</div>}
        {link.description && <p className="text-[11px] text-muted-foreground line-clamp-2">{link.description}</p>}
        {hasDownloadUrl && <div className="text-[10px] text-zinc-600 bg-zinc-100 rounded px-1.5 py-0.5"><span className="font-semibold text-pink-600">{link.qualityLabel}</span></div>}
        <div className="text-[10px] text-muted-foreground">{fmtDate(link.createdAt)}</div>
        <div className="flex gap-1 mt-auto flex-wrap">
          {hasDownloadUrl && link.kind === 'video' && <Button asChild size="sm" className="h-6 text-[10px] px-2 bg-black text-white"><a href={buildDownloadUrl(link.downloadUrl!, videoId, 'video')} download><Download className="w-2.5 h-2.5" /> {link.qualityLabel || 'Descargar'}</a></Button>}
          {hasDownloadUrl && link.kind === 'video' && <Button size="sm" variant="outline" onClick={onPreview} className="h-6 text-[10px] px-2"><Play className="w-2.5 h-2.5" /> Play</Button>}
          <Button size="sm" variant="outline" onClick={onReScrape} className="h-6 text-[10px] px-2"><Search className="w-2.5 h-2.5" /> {hasDownloadUrl ? 'Refresh' : 'Extraer'}</Button>
        </div>
      </CardContent>
    </Card>
  )
}
