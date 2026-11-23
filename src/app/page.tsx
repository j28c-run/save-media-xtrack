'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import {
  Download, Search, Film, Image as ImageIcon, History, Loader2, CheckCircle2,
  ExternalLink, Calendar, Clock, Flame, Sparkles, Link as LinkIcon,
  HardDriveDownload, Play, Pause, Layers, Music2, Camera,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import TiktokView from '@/components/tiktok-view'
import InstagramView from '@/components/instagram-view'

type SnapSource = 'currentStory'
type MediaType = 'mp4' | 'jpg' | 'bin'

interface SnapInfo {
  id: string; source: SnapSource; snapIndex: number | null
  timestampSec: number | null; isoDate: string | null; expiresAtSec: number | null
  expiresAtIso: string | null; timeLeftSec: number | null
  mediaUrl: string; previewUrl: string | null; mediaType: MediaType
}

interface ScrapeResult {
  username: string; displayName: string | null; followerCount: string | null
  lastUpdated: string | null; storyExpired: boolean; snaps: SnapInfo[]
  stats: { total: number; videos: number; images: number; expiringSoon: number; expired: number; byDay: Record<string, number> }
}

interface SavedSnapLink {
  id: string; snapId: string | null; source: string
  timestampSec: number | null; isoDate: string | null; expiresAtSec: number | null
  mediaType: string; originalUrl: string; previewUrl: string | null
  localPath: string | null; fileSize: number; downloadedAt: string | null
  fileDeletedAt: string | null; timeLeftSec: number | null
}

interface HistoryByDay { [day: string]: SavedSnapLink[] }

interface HistoryResult {
  account: { username: string; displayName: string | null; followerCount: string | null; lastScrapedAt: string | null }
  stats: { totalLinks: number; downloaded: number; expiringSoon: number; expired: number }
  byDay: HistoryByDay
}

interface AccountList {
  accounts: Array<{
    id: string; username: string; displayName: string | null; followerCount: string | null
    lastScrapedAt: string | null; totalLinks: number; downloaded: number; latestSnap: string | null
  }>
}

type MediaFilter = 'all' | 'images' | 'videos'
type DateFilter = 'all' | 'today' | 'yesterday' | 'expiring'

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { const d = new Date(iso); return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

function fmtDayLabel(day: string): string {
  if (day === 'unknown') return 'Sin fecha'
  const today = new Date().toISOString().slice(0, 10)
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  if (day === today) return 'Hoy'
  if (day === y) return 'Ayer'
  try { const d = new Date(day + 'T00:00:00'); return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' }) }
  catch { return day }
}

function fmtDayShort(day: string): string {
  if (day === 'unknown') return 'Sin fecha'
  const today = new Date().toISOString().slice(0, 10)
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  if (day === today) return 'Hoy'
  if (day === y) return 'Ayer'
  try { const d = new Date(day + 'T00:00:00'); return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) }
  catch { return day }
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function fmtTimeLeft(sec: number | null): { text: string; severity: 'ok' | 'soon' | 'expired' } {
  if (sec === null) return { text: '—', severity: 'ok' }
  if (sec < 0) { const h = Math.abs(Math.floor(sec / 3600)); return { text: `Expiró hace ${h}h`, severity: 'expired' } }
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60)
  if (h < 1) return { text: `${m}m`, severity: 'soon' }
  if (h < 6) return { text: `${h}h ${m}m`, severity: 'soon' }
  return { text: `${h}h ${m}m`, severity: 'ok' }
}

function buildDownloadUrl(snap: { mediaUrl: string; mediaType: string; timestampSec?: number | null; isoDate?: string | null }, username: string): string {
  const ts = snap.timestampSec || 'nots'
  const day = snap.isoDate ? snap.isoDate.slice(0, 10) : 'unknown'
  const ext = snap.mediaType === 'mp4' ? 'mp4' : 'jpg'
  const filename = `${username}_${day}_${ts}.${ext}`
  return `/api/proxy?url=${encodeURIComponent(snap.mediaUrl)}&filename=${encodeURIComponent(filename)}`
}

export default function Home() {
  const [username, setUsername] = useState('dlaribi2')
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null)
  const [scraping, setScraping] = useState(false)
  const [savingLinks, setSavingLinks] = useState(false)
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set())
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [history, setHistory] = useState<HistoryResult | null>(null)
  const [accounts, setAccounts] = useState<AccountList['accounts']>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [previewSnap, setPreviewSnap] = useState<SnapInfo | SavedSnapLink | null>(null)
  const [storyPlayerSnaps, setStoryPlayerSnaps] = useState<SnapInfo[]>([])
  const [storyPlayerIndex, setStoryPlayerIndex] = useState(0)
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  const [yearFilter, setYearFilter] = useState<string>('all')
  const [monthFilter, setMonthFilter] = useState<string>('all')
  const [historyMediaFilter, setHistoryMediaFilter] = useState<MediaFilter>('all')
  const [activeNetwork, setActiveNetwork] = useState<'snapchat' | 'tiktok' | 'instagram'>('snapchat')
  const { toast } = useToast()

  const scrape = useCallback(async () => {
    if (!username.trim()) { toast({ title: 'Falta el usuario', variant: 'destructive' }); return }
    setScraping(true); setScrapeResult(null)
    try {
      const r = await fetch(`/api/scrape?username=${encodeURIComponent(username.trim())}`)
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Falló el scrapeo')
      setScrapeResult(data)
      if (data.snaps.length === 0) { toast({ title: 'Sin stories de 24h', description: 'El perfil no tiene story activa ahora' }) }
      else { toast({ title: `${data.snaps.length} snaps encontrados`, description: `${data.stats.videos} videos · ${data.stats.images} imágenes · ${data.stats.expiringSoon} por expirar` }) }
    } catch (e) { toast({ title: 'Error al scrape', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }) }
    finally { setScraping(false) }
  }, [username, toast])

  const saveLinks = useCallback(async () => {
    if (!scrapeResult) return
    setSavingLinks(true)
    try {
      const r = await fetch('/api/save-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: scrapeResult.username, snaps: scrapeResult.snaps.map(s => ({ id: s.id, source: s.source, snapIndex: s.snapIndex, timestampSec: s.timestampSec, isoDate: s.isoDate, expiresAtSec: s.expiresAtSec, mediaType: s.mediaType, mediaUrl: s.mediaUrl, previewUrl: s.previewUrl })) }) })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      toast({ title: 'Enlaces guardados', description: `${data.newLinks} nuevos · ${data.duplicates} ya estaban` })
      loadHistory(scrapeResult.username); loadAccounts()
    } catch (e) { toast({ title: 'Error al guardar enlaces', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }) }
    finally { setSavingLinks(false) }
  }, [scrapeResult, toast])

  const downloadToServer = useCallback(async (snap: SnapInfo) => {
    const key = `${snap.source}-${snap.id}`
    setDownloadingIds(prev => new Set(prev).add(key))
    try {
      const r = await fetch('/api/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: scrapeResult?.username || username, snaps: [{ id: snap.id, source: snap.source, snapIndex: snap.snapIndex, timestampSec: snap.timestampSec, isoDate: snap.isoDate, expiresAtSec: snap.expiresAtSec, mediaType: snap.mediaType, mediaUrl: snap.mediaUrl, previewUrl: snap.previewUrl }] }) })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      toast({ title: 'Guardado en servidor', description: `${fmtSize(data.results[0]?.size || 0)} · ${data.results[0]?.relPath}` })
      loadHistory(scrapeResult?.username || username)
    } catch (e) { toast({ title: 'Error al guardar', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }) }
    finally { setDownloadingIds(prev => { const next = new Set(prev); next.delete(key); return next }) }
  }, [scrapeResult, username, toast])

  const loadHistory = useCallback(async (user: string) => {
    setLoadingHistory(true)
    try { const r = await fetch(`/api/history?username=${encodeURIComponent(user)}`); if (r.status === 404) { setHistory(null); return } const data = await r.json(); if (!r.ok) throw new Error(data.error); setHistory(data) } catch {} finally { setLoadingHistory(false) }
  }, [])

  const loadAccounts = useCallback(async () => { try { const r = await fetch('/api/accounts'); const data = await r.json(); if (r.ok) setAccounts(data.accounts || []) } catch {} }, [])

  useEffect(() => { loadAccounts() }, [loadAccounts])
  useEffect(() => { if (username.trim()) loadHistory(username.trim()) }, [username, loadHistory])

  const [, setTick] = useState(0)
  useEffect(() => { const i = setInterval(() => setTick(t => t + 1), 30000); return () => clearInterval(i) }, [])

  const filteredSnaps = useMemo(() => {
    if (!scrapeResult) return []
    const today = new Date().toISOString().slice(0, 10)
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    return scrapeResult.snaps.filter(s => {
      if (mediaFilter === 'images' && s.mediaType !== 'jpg') return false
      if (mediaFilter === 'videos' && s.mediaType !== 'mp4') return false
      if (dateFilter === 'today' && s.isoDate?.slice(0, 10) !== today) return false
      if (dateFilter === 'yesterday' && s.isoDate?.slice(0, 10) !== yest) return false
      if (dateFilter === 'expiring' && (s.timeLeftSec === null || s.timeLeftSec < 0 || s.timeLeftSec > 6 * 3600)) return false
      return true
    })
  }, [scrapeResult, mediaFilter, dateFilter])

  const groupedSnaps = useMemo(() => {
    const byDay: Record<string, SnapInfo[]> = {}
    for (const s of filteredSnaps) { const day = s.isoDate?.slice(0, 10) || 'unknown'; if (!byDay[day]) byDay[day] = []; byDay[day].push(s) }
    let counter = 1
    const entries = Object.entries(byDay).sort(([a], [b]) => (a < b ? 1 : -1))
    for (const [, snaps] of entries) { for (const s of snaps) { (s as SnapInfo & { displayNumber?: number }).displayNumber = counter++ } }
    return entries
  }, [filteredSnaps])

  const historyDays = history ? Object.keys(history.byDay).sort().reverse() : []

  return (
    <div className="min-h-screen flex bg-zinc-100">
      <aside className="w-16 sm:w-56 bg-white border-r border-zinc-200 flex flex-col sticky top-0 h-screen z-30">
        <div className="p-3 border-b border-zinc-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 via-pink-500 to-cyan-400 flex items-center justify-center flex-shrink-0">
              <Download className="w-4 h-4 text-white" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-sm font-extrabold leading-tight">Multi Saver</h1>
              <p className="text-[10px] text-muted-foreground leading-tight">Redes sociales</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          <button onClick={() => setActiveNetwork('snapchat')} className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors ${activeNetwork === 'snapchat' ? 'bg-yellow-100 text-zinc-900 font-semibold' : 'text-zinc-600 hover:bg-zinc-100'}`}>
            <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0 text-yellow-500" fill="currentColor"><path d="M12.206.793c.99 0 4.347 2.215 5.31 5.741.859 3.142-.487 6.37-.487 6.37s1.574.78 1.574 2.155c0 1.418-1.582 2.143-1.582 2.143s.346.78.346 1.528c0 1.51-1.997 2.217-1.997 2.217s-.357 1.435-1.715 1.435c-1.357 0-1.65-1.028-1.65-1.028s-.293 1.028-1.65 1.028c-1.358 0-1.715-1.435-1.715-1.435s-1.997-.707-1.997-2.217c0-.748.346-1.528.346-1.528S6.317 16.48 6.317 15.06c0-1.376 1.574-2.155 1.574-2.155s-1.346-3.228-.487-6.37C8.367 3.008 11.724.793 12.713.793z" /></svg>
            <span className="hidden sm:block">Snapchat</span>
            <span className="hidden sm:block ml-auto text-[10px] text-muted-foreground">historias</span>
          </button>
          <button onClick={() => setActiveNetwork('tiktok')} className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors ${activeNetwork === 'tiktok' ? 'bg-zinc-900 text-white font-semibold' : 'text-zinc-600 hover:bg-zinc-100'}`}>
            <Music2 className={`w-5 h-5 flex-shrink-0 ${activeNetwork === 'tiktok' ? 'text-pink-400' : 'text-pink-500'}`} />
            <span className="hidden sm:block">TikTok</span>
            <span className="hidden sm:block ml-auto text-[10px] opacity-60">videos</span>
          </button>
          <button onClick={() => setActiveNetwork('instagram')} className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors ${activeNetwork === 'instagram' ? 'bg-gradient-to-r from-purple-500 via-pink-500 to-amber-400 text-white font-semibold' : 'text-zinc-600 hover:bg-zinc-100'}`}>
            <Camera className={`w-5 h-5 flex-shrink-0 ${activeNetwork === 'instagram' ? 'text-white' : 'text-purple-500'}`} />
            <span className="hidden sm:block">Instagram</span>
            <span className="hidden sm:block ml-auto text-[10px] opacity-60">reels/fotos</span>
          </button>
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
      {activeNetwork === 'snapchat' ? (
        <>
      <header className="border-b border-zinc-200 bg-yellow-400 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-6 h-6 text-yellow-400" fill="currentColor"><path d="M12.206.793c.99 0 4.347 2.215 5.31 5.741.859 3.142-.487 6.37-.487 6.37s1.574.78 1.574 2.155c0 1.418-1.582 2.143-1.582 2.143s.346.78.346 1.528c0 1.51-1.997 2.217-1.997 2.217s-.357 1.435-1.715 1.435c-1.357 0-1.65-1.028-1.65-1.028s-.293 1.028-1.65 1.028c-1.358 0-1.715-1.435-1.715-1.435s-1.997-.707-1.997-2.217c0-.748.346-1.528.346-1.528S6.317 16.48 6.317 15.06c0-1.376 1.574-2.155 1.574-2.155s-1.346-3.228-.487-6.37C8.367 3.008 11.724.793 12.713.793z" /></svg>
            </div>
            <div>
              <h1 className="text-lg font-extrabold leading-tight text-black">Snap Saver</h1>
              <p className="text-xs text-black/70 leading-tight">Historias de 24h · guarda enlaces, descarga lo que quieras</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        {accounts.length > 0 && (
          <Card className="mb-4 border-yellow-300 bg-yellow-50">
            <CardContent className="p-3">
              <p className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-yellow-500" /> ACCESOS DIRECTOS</p>
              <div className="flex flex-wrap gap-1.5">
                {accounts.map(a => (
                  <Button key={a.id} size="sm" variant={a.username === username ? 'default' : 'outline'} onClick={() => setUsername(a.username)} className={`h-7 text-xs ${a.username === username ? 'bg-yellow-400 text-black hover:bg-yellow-500 border-yellow-400' : 'border-yellow-300 text-zinc-700 hover:bg-yellow-100'}`}>@{a.username} <span className="opacity-60 ml-1">{a.totalLinks}</span></Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pegá el usuario o la URL del perfil</CardTitle>
            <CardDescription>Solo extrae las <strong>historias de 24 horas</strong> actuales. No trae highlights ni spotlight.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') scrape() }} placeholder="dlaribi2 o https://www.snapchat.com/@dlaribi2" className="flex-1" />
              <Button onClick={scrape} disabled={scraping || !username.trim()} className="bg-yellow-400 text-black hover:bg-yellow-500">
                {scraping ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Extrayendo…</> : <><Search className="w-4 h-4 mr-2" /> Extraer</>}
              </Button>
            </div>
            {scrapeResult && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={saveLinks} disabled={savingLinks} className="border-zinc-300">
                  {savingLinks ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <LinkIcon className="w-3.5 h-3.5 mr-1.5" />}
                  Guardar enlaces ({scrapeResult.snaps.length})
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Tabs defaultValue="current" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="current"><Film className="w-4 h-4 mr-2" /> Stories 24h {scrapeResult ? `(${scrapeResult.snaps.length})` : ''}</TabsTrigger>
            <TabsTrigger value="history"><History className="w-4 h-4 mr-2" /> Historial {history ? `(${history.stats.totalLinks})` : ''}</TabsTrigger>
          </TabsList>

          <TabsContent value="current" className="space-y-6">
            {!scrapeResult && !scraping && (
              <Card><CardContent className="py-12 text-center text-muted-foreground">
                <Search className="w-10 h-10 mx-auto mb-3 opacity-40 text-yellow-500" />
                <p className="text-sm">Ingresá un usuario y hacé clic en <strong>Extraer</strong>.</p>
                <p className="text-xs mt-1">Solo historias de las últimas 24 horas.</p>
              </CardContent></Card>
            )}

            {scrapeResult && (
              <>
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-4 justify-between">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-lg font-bold">@{scrapeResult.username}</h2>
                          {scrapeResult.displayName && <span className="text-sm text-muted-foreground">{scrapeResult.displayName}</span>}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          {scrapeResult.followerCount && <span>{scrapeResult.followerCount} seguidores</span>}
                          {scrapeResult.lastUpdated && <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> {scrapeResult.lastUpdated}</span>}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Badge variant="outline" className="border-zinc-300"><Film className="w-3 h-3 mr-1" /> {scrapeResult.stats.videos} videos</Badge>
                        <Badge variant="outline" className="border-zinc-300"><ImageIcon className="w-3 h-3 mr-1" /> {scrapeResult.stats.images} imgs</Badge>
                        {scrapeResult.stats.expiringSoon > 0 && <Badge variant="outline" className="border-orange-400 text-orange-600"><Flame className="w-3 h-3 mr-1" /> {scrapeResult.stats.expiringSoon} por expirar</Badge>}
                      </div>
                    </div>

                    <div className="border-t border-zinc-200 pt-3 flex flex-wrap gap-2 items-center">
                      <span className="text-xs font-semibold text-zinc-600">Tipo:</span>
                      <div className="flex gap-1">
                        {(['all', 'images', 'videos'] as MediaFilter[]).map(f => (
                          <Button key={f} size="sm" variant={mediaFilter === f ? 'default' : 'outline'} onClick={() => setMediaFilter(f)} className={`h-7 text-xs ${mediaFilter === f ? 'bg-yellow-400 text-black hover:bg-yellow-500' : ''}`}>
                            {f === 'all' ? 'Todos' : f === 'images' ? 'Imágenes' : 'Videos'}
                            {f !== 'all' && <span className="ml-1 opacity-70">{f === 'images' ? scrapeResult.stats.images : scrapeResult.stats.videos}</span>}
                          </Button>
                        ))}
                      </div>
                      <div className="flex gap-1 ml-auto items-center">
                        {(['all', 'today', 'yesterday', 'expiring'] as DateFilter[]).map(f => (
                          <Button key={f} size="sm" variant={dateFilter === f ? 'secondary' : 'ghost'} onClick={() => setDateFilter(f)} className="h-7 text-xs">
                            {f === 'all' ? 'Todas' : f === 'today' ? 'Hoy' : f === 'yesterday' ? 'Ayer' : 'Por expirar'}
                          </Button>
                        ))}
                      </div>
                    </div>
                    {scrapeResult.stats.videos > 0 && (
                      <div className="flex justify-end mt-2">
                        <Button size="sm" onClick={() => { setStoryPlayerSnaps(filteredSnaps); setStoryPlayerIndex(0) }} className="bg-black text-white hover:bg-zinc-800">
                          <Play className="w-4 h-4 mr-2" /> Reproducir videos
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {groupedSnaps.length === 0 && <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Ningún snap con los filtros seleccionados.</CardContent></Card>}

                {groupedSnaps.map(([day, snaps]) => {
                  const dayVideos = snaps.filter(s => s.mediaType === 'mp4').length
                  const dayImgs = snaps.filter(s => s.mediaType === 'jpg').length
                  return (
                    <div key={day} className="bg-white rounded-xl border border-zinc-200 shadow-md overflow-hidden">
                      <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-3 bg-yellow-50 border-b-2 border-yellow-300">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-yellow-600" />
                          <h3 className="font-bold text-sm text-zinc-900">{fmtDayLabel(day)}</h3>
                          <Badge className="text-xs bg-yellow-400 text-black hover:bg-yellow-500">{snaps.length} snaps</Badge>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {dayVideos > 0 && <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-zinc-300 bg-white"><Film className="w-2.5 h-2.5 mr-1" /> {dayVideos}</Badge>}
                          {dayImgs > 0 && <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-zinc-300 bg-white"><ImageIcon className="w-2.5 h-2.5 mr-1" /> {dayImgs}</Badge>}
                        </div>
                      </div>
                      <div className="p-4 bg-white">
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                          {snaps.map(snap => {
                            const num = (snap as SnapInfo & { displayNumber?: number }).displayNumber
                            return <SnapCard key={`${snap.source}-${snap.id}`} snap={snap} number={num || 0} onPreview={() => setPreviewSnap(snap)} onSaveToServer={() => downloadToServer(snap)} isDownloading={downloadingIds.has(`${snap.source}-${snap.id}`)} username={scrapeResult.username} />
                          })}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-6">
            {loadingHistory && !history && <Card><CardContent className="py-12 text-center text-muted-foreground"><Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" /><p className="text-sm">Cargando historial…</p></CardContent></Card>}
            {!loadingHistory && !history && <Card><CardContent className="py-12 text-center text-muted-foreground"><History className="w-10 h-10 mx-auto mb-3 opacity-40" /><p className="text-sm">Sin enlaces guardados para <strong>@{username}</strong>.</p><p className="text-xs mt-1">Extraé y luego <strong>Guardar enlaces</strong>.</p></CardContent></Card>}
            {history && (
              <>
                {(() => {
                  const years = Array.from(new Set(historyDays.map(d => d.slice(0, 4)))).sort().reverse()
                  const months = Array.from(new Set(historyDays.filter(d => yearFilter === 'all' || d.slice(0, 4) === yearFilter).map(d => d.slice(0, 7)))).sort().reverse()
                  const monthsEs = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
                  return (
                    <Card className="mb-4">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-3">
                          <div>
                            <h2 className="text-lg font-bold">@{history.account.username}</h2>
                            {history.account.displayName && <p className="text-sm text-muted-foreground">{history.account.displayName}</p>}
                          </div>
                          <div className="flex gap-3 flex-wrap text-center">
                            <div><div className="text-xl font-bold">{history.stats.totalLinks}</div><div className="text-[10px] text-muted-foreground">enlaces</div></div>
                            <div><div className="text-xl font-bold text-green-600">{history.stats.downloaded}</div><div className="text-[10px] text-muted-foreground">en server</div></div>
                            {history.stats.expiringSoon > 0 && <div><div className="text-xl font-bold text-orange-600">{history.stats.expiringSoon}</div><div className="text-[10px] text-muted-foreground">por expirar</div></div>}
                          </div>
                        </div>
                        <div className="border-t border-zinc-200 pt-3 flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-zinc-600">Fecha:</span>
                          <select value={yearFilter} onChange={e => { setYearFilter(e.target.value); setMonthFilter('all'); setExpandedDay(null) }} className="h-7 text-xs border border-zinc-300 rounded px-1 bg-white">
                            <option value="all">Todos los años ({historyDays.length} días)</option>
                            {years.map(y => <option key={y} value={y}>{y} ({historyDays.filter(d => d.slice(0, 4) === y).length} días)</option>)}
                          </select>
                          <select value={monthFilter} onChange={e => { setMonthFilter(e.target.value); setExpandedDay(null) }} className="h-7 text-xs border border-zinc-300 rounded px-1 bg-white" disabled={yearFilter === 'all'}>
                            <option value="all">Todos los meses</option>
                            {months.map(m => { const [y, mo] = m.split('-'); return <option key={m} value={m}>{monthsEs[Number(mo) - 1]} {y} ({historyDays.filter(d => d.slice(0, 7) === m).length} días)</option> })}
                          </select>
                          {(yearFilter !== 'all' || monthFilter !== 'all') && <Button size="sm" variant="ghost" onClick={() => { setYearFilter('all'); setMonthFilter('all'); setExpandedDay(null) }} className="h-7 text-xs">Limpiar</Button>}
                        </div>
                      </CardContent>
                    </Card>
                  )
                })()}
                {(() => {
                  const filteredDays = historyDays.filter(d => {
                    if (yearFilter !== 'all' && d.slice(0, 4) !== yearFilter) return false
                    if (monthFilter !== 'all' && d.slice(0, 7) !== monthFilter) return false
                    return true
                  })
                  if (filteredDays.length === 0) return <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Sin días con los filtros seleccionados.</CardContent></Card>
                  return (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
                        {filteredDays.map(day => <DayStackCard key={day} day={day} snaps={history.byDay[day]} allSnapsCount={history.byDay[day].length} username={history.account.username} isExpanded={expandedDay === day} onClick={() => setExpandedDay(expandedDay === day ? null : day)} />)}
                      </div>
                      {expandedDay && (
                        <div className="bg-white rounded-xl border-2 border-yellow-400 shadow-lg overflow-hidden">
                          {(() => {
                            const daySnapsAll = history.byDay[expandedDay]
                            const dayVideos = daySnapsAll.filter(s => s.mediaType === 'mp4').length
                            const dayImgs = daySnapsAll.filter(s => s.mediaType === 'jpg').length
                            const expandedSnaps = daySnapsAll.filter(s => {
                              if (historyMediaFilter === 'images') return s.mediaType === 'jpg'
                              if (historyMediaFilter === 'videos') return s.mediaType === 'mp4'
                              return true
                            })
                            return (
                              <>
                                <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-3 bg-yellow-50 border-b-2 border-yellow-300">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Calendar className="w-4 h-4 text-yellow-600" />
                                    <h3 className="font-bold text-sm text-zinc-900">{fmtDayLabel(expandedDay)}</h3>
                                    <Badge className="text-xs bg-yellow-400 text-black hover:bg-yellow-500">{expandedSnaps.length} snaps</Badge>
                                  </div>
                                  <button onClick={() => setExpandedDay(null)} className="text-zinc-400 hover:text-zinc-700 text-xl leading-none px-2" aria-label="Cerrar">×</button>
                                </div>
                                <div className="px-4 py-2 bg-white border-b border-zinc-100 flex flex-wrap items-center gap-2 justify-between">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-semibold text-zinc-600">Tipo:</span>
                                    <div className="flex gap-1">
                                      <Button size="sm" variant={historyMediaFilter === 'all' ? 'default' : 'outline'} onClick={() => setHistoryMediaFilter('all')} className={`h-7 text-xs ${historyMediaFilter === 'all' ? 'bg-yellow-400 text-black hover:bg-yellow-500' : ''}`}>Todos <span className="ml-1 opacity-70">{daySnapsAll.length}</span></Button>
                                      <Button size="sm" variant={historyMediaFilter === 'images' ? 'default' : 'outline'} onClick={() => setHistoryMediaFilter('images')} className={`h-7 text-xs ${historyMediaFilter === 'images' ? 'bg-yellow-400 text-black hover:bg-yellow-500' : ''}`}>Imágenes <span className="ml-1 opacity-70">{dayImgs}</span></Button>
                                      <Button size="sm" variant={historyMediaFilter === 'videos' ? 'default' : 'outline'} onClick={() => setHistoryMediaFilter('videos')} className={`h-7 text-xs ${historyMediaFilter === 'videos' ? 'bg-yellow-400 text-black hover:bg-yellow-500' : ''}`}>Videos <span className="ml-1 opacity-70">{dayVideos}</span></Button>
                                    </div>
                                  </div>
                                  {dayVideos > 0 && (
                                    <Button size="sm" onClick={() => { const vids = expandedSnaps.filter(s => s.mediaType === 'mp4').map(s => ({ id: s.id, source: 'currentStory' as SnapSource, snapIndex: null, timestampSec: s.timestampSec, isoDate: s.isoDate, expiresAtSec: null, expiresAtIso: null, timeLeftSec: null, mediaUrl: s.originalUrl, previewUrl: s.previewUrl, mediaType: 'mp4' as MediaType })); setStoryPlayerSnaps(vids); setStoryPlayerIndex(0) }} className="h-7 text-xs bg-black text-white hover:bg-zinc-800">
                                      <Play className="w-3 h-3 mr-1" /> Reproducir
                                    </Button>
                                  )}
                                </div>
                                <div className="p-4 bg-white">
                                  {expandedSnaps.length === 0 ? <div className="py-6 text-center text-muted-foreground text-sm">Sin snaps del tipo seleccionado para este día.</div> : (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                                      {expandedSnaps.map((snap, i) => <HistorySnapCard key={snap.id} snap={snap} number={i + 1} username={history.account.username} onPreview={() => setPreviewSnap(snap)} />)}
                                    </div>
                                  )}
                                </div>
                              </>
                            )
                          })()}
                        </div>
                      )}
                    </>
                  )
                })()}
              </>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t border-zinc-200 py-4 mt-auto bg-white">
        <div className="max-w-6xl mx-auto px-4 text-center text-xs text-muted-foreground">Snap Saver · Solo historias de 24h · Enlaces persistentes · Descarga selectiva</div>
      </footer>

      <PreviewDialog snap={previewSnap} username={scrapeResult?.username || username} onClose={() => setPreviewSnap(null)} onSaveToServer={async (s) => { if ('source' in s) { await downloadToServer(s as SnapInfo) } }} />
      </>
      ) : activeNetwork === 'tiktok' ? (
        <TiktokView />
      ) : (
        <InstagramView />
      )}

      {storyPlayerSnaps.length > 0 && (
        <StoryPlayer snaps={storyPlayerSnaps} startIndex={storyPlayerIndex} onClose={() => { setStoryPlayerSnaps([]); setStoryPlayerIndex(0) }} onIndexChange={setStoryPlayerIndex} />
      )}
      </div>
    </div>
  )
}

function StoryPlayer({ snaps, startIndex, onClose }: { snaps: SnapInfo[]; startIndex: number; onClose: () => void; onIndexChange: (i: number) => void }) {
  const videos = useMemo(() => snaps.filter(s => s.mediaType === 'mp4'), [snaps])
  const [index, setIndex] = useState(Math.min(startIndex, Math.max(0, videos.length - 1)))
  const current = videos[index]
  const goNext = useCallback(() => { setIndex(prev => { if (prev + 1 >= videos.length) { onClose(); return prev } return prev + 1 }) }, [videos.length, onClose])
  const goPrev = useCallback(() => { setIndex(p => Math.max(0, p - 1)) }, [])
  if (!current) return <div className="fixed inset-0 z-50 bg-black flex items-center justify-center"><p className="text-white">Sin videos para reproducir</p><button onClick={onClose} className="absolute top-4 right-4 text-white text-2xl">×</button></div>
  const videoSrc = current.mediaUrl.startsWith('http') ? `/api/proxy?url=${encodeURIComponent(current.mediaUrl)}` : current.mediaUrl
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-black/90 border-b border-white/10">
        <span className="text-white text-sm font-medium">Video {index + 1} de {videos.length}</span>
        <div className="flex items-center gap-1">
          <button onClick={goPrev} disabled={index === 0} className="text-white p-1.5 rounded hover:bg-white/10 disabled:opacity-20"><ChevronLeft className="w-5 h-5" /></button>
          <button onClick={goNext} disabled={index >= videos.length - 1} className="text-white p-1.5 rounded hover:bg-white/10 disabled:opacity-20"><ChevronRight className="w-5 h-5" /></button>
          <button onClick={onClose} className="text-white text-xl w-8 h-8 rounded hover:bg-white/10 flex items-center justify-center ml-1">×</button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <video key={videoSrc} src={videoSrc} controls autoPlay playsInline className="h-full w-full object-contain" onEnded={goNext} />
      </div>
    </div>
  )
}

function DayStackCard({ day, snaps, allSnapsCount, username, isExpanded, onClick }: { day: string; snaps: SavedSnapLink[]; allSnapsCount: number; username: string; isExpanded: boolean; onClick: () => void }) {
  const dayVideos = snaps.filter(s => s.mediaType === 'mp4').length
  const dayImgs = snaps.filter(s => s.mediaType === 'jpg').length
  const dayOnServer = snaps.filter(s => !!s.localPath).length
  const nowSec = Math.floor(Date.now() / 1000)
  const dayExpiring = snaps.filter(s => { if (!s.expiresAtSec) return false; const left = s.expiresAtSec - nowSec; return left > 0 && left < 6 * 3600 }).length
  const stackSnaps = [...snaps].sort((a, b) => (b.timestampSec || 0) - (a.timestampSec || 0)).slice(0, 3).reverse()
  return (
    <button onClick={onClick} className={`group block text-left w-full focus:outline-none focus:ring-2 focus:ring-yellow-400 rounded-xl transition-all ${isExpanded ? 'ring-2 ring-yellow-400 ring-offset-2' : ''}`} aria-label={`Ver snaps de ${fmtDayLabel(day)}`} aria-expanded={isExpanded}>
      <div className="relative h-56 mb-2">
        {stackSnaps.length >= 3 && <div className="absolute inset-0 bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden" style={{ transform: 'rotate(-6deg) translate(-8px, 4px)' }}>{stackSnaps[2].previewUrl && <img src={stackSnaps[2].previewUrl} alt="" className="w-full h-full object-cover opacity-60" />}</div>}
        {stackSnaps.length >= 2 && <div className="absolute inset-0 bg-white rounded-xl border border-zinc-200 shadow overflow-hidden" style={{ transform: 'rotate(4deg) translate(6px, 2px)' }}>{stackSnaps[1].previewUrl && <img src={stackSnaps[1].previewUrl} alt="" className="w-full h-full object-cover opacity-80" />}</div>}
        <div className={`absolute inset-0 bg-white rounded-xl overflow-hidden transition-shadow ${isExpanded ? 'border-2 border-yellow-400 shadow-lg' : 'border border-zinc-300 shadow-md group-hover:shadow-lg'}`}>
          {stackSnaps[0]?.previewUrl ? <img src={stackSnaps[0].previewUrl} alt="" className="w-full h-full object-cover" /> : stackSnaps[0]?.localPath ? <img src={stackSnaps[0].localPath} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-zinc-100 text-zinc-400"><Layers className="w-8 h-8" /></div>}
          <div className="absolute top-1.5 right-1.5 bg-black/70 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full">{snaps.length}{snaps.length !== allSnapsCount && <span className="opacity-60 font-normal">/{allSnapsCount}</span>}</div>
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
            <span className="opacity-0 group-hover:opacity-100 text-white text-xs font-semibold bg-yellow-400 text-black px-2 py-1 rounded">{isExpanded ? 'Abierto abajo ▼' : 'Ver snaps'}</span>
          </div>
        </div>
      </div>
      <div className="px-1">
        <div className="flex items-center justify-between gap-1">
          <h3 className="font-bold text-sm text-zinc-900 truncate">{fmtDayShort(day)}</h3>
          {dayOnServer > 0 && <Badge variant="outline" className="text-[9px] h-4 px-1 border-green-400 text-green-600 bg-white"><CheckCircle2 className="w-2.5 h-2.5 mr-0.5" /> {dayOnServer}</Badge>}
        </div>
        <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
          {dayVideos > 0 && <span className="inline-flex items-center gap-0.5"><Film className="w-2.5 h-2.5" /> {dayVideos}</span>}
          {dayImgs > 0 && <span className="inline-flex items-center gap-0.5"><ImageIcon className="w-2.5 h-2.5" /> {dayImgs}</span>}
          {dayExpiring > 0 && <span className="inline-flex items-center gap-0.5 text-orange-600"><Flame className="w-2.5 h-2.5" /> {dayExpiring}</span>}
        </div>
      </div>
    </button>
  )
}

function PreviewDialog({ snap, username, onClose, onSaveToServer }: { snap: SnapInfo | SavedSnapLink | null; username: string; onClose: () => void; onSaveToServer: (s: SnapInfo | SavedSnapLink) => Promise<void> }) {
  if (!snap) return null
  const isSnapInfo = (s: SnapInfo | SavedSnapLink): s is SnapInfo => 'source' in s && 'mediaType' in s && typeof s.mediaType === 'string'
  const mediaUrl = 'mediaUrl' in snap ? snap.mediaUrl : snap.originalUrl
  const previewUrl = snap.previewUrl
  const mediaType = (snap.mediaType as MediaType) || 'bin'
  const isVideo = mediaType === 'mp4'
  const ts = snap.timestampSec
  const iso = snap.isoDate
  const tl = fmtTimeLeft(snap.timeLeftSec)
  const hasFileOnServer = 'localPath' in snap && snap.localPath
  const videoSrc = hasFileOnServer ? snap.localPath! : mediaUrl
  const imgSrc = hasFileOnServer ? snap.localPath! : previewUrl || mediaUrl
  const downloadHref = buildDownloadUrl({ mediaUrl, mediaType, timestampSec: ts, isoDate: iso }, username)
  return (
    <Dialog open={!!snap} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden gap-0">
        <DialogHeader className="p-3 border-b border-zinc-100 flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2 flex-wrap">
            <DialogTitle className="text-sm">Preview</DialogTitle>
            <Badge variant="outline" className="text-xs">{isVideo ? <><Film className="w-3 h-3 mr-1 inline" /> MP4</> : <><ImageIcon className="w-3 h-3 mr-1 inline" /> JPG</>}</Badge>
            <Badge variant="outline" className={`text-xs ${tl.severity === 'expired' ? 'border-red-400 text-red-600' : tl.severity === 'soon' ? 'border-orange-400 text-orange-600' : ''}`}><Clock className="w-3 h-3 mr-1 inline" /> {tl.text}</Badge>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-xl leading-none px-2" aria-label="Cerrar">×</button>
        </DialogHeader>
        <div className="bg-black flex items-center justify-center max-h-[70vh]">
          {isVideo ? <video src={videoSrc} controls autoPlay className="max-h-[70vh] max-w-full" /> : <img src={imgSrc} alt="preview" className="max-h-[70vh] max-w-full object-contain" />}
        </div>
        <div className="p-3 border-t border-zinc-100 space-y-3 bg-white">
          <div className="text-xs text-muted-foreground grid grid-cols-2 gap-2">
            <div><span className="text-zinc-500">Fecha:</span> {fmtDate(iso)}</div>
            <div><span className="text-zinc-500">Estado:</span> {hasFileOnServer ? <span className="text-green-600 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> en servidor</span> : <span className="inline-flex items-center gap-1"><LinkIcon className="w-3 h-3" /> enlace</span>}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isSnapInfo(snap) && <Button size="sm" onClick={() => onSaveToServer(snap)} className="bg-yellow-400 text-black hover:bg-yellow-500"><HardDriveDownload className="w-3.5 h-3.5 mr-1.5" /> Guardar en servidor</Button>}
            <Button asChild size="sm" variant="outline"><a href={downloadHref} download><Download className="w-3.5 h-3.5 mr-1.5" /> Descargar</a></Button>
            <Button asChild size="sm" variant="ghost"><a href={mediaUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Abrir original</a></Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SnapCard({ snap, number, onPreview, onSaveToServer, isDownloading, username }: { snap: SnapInfo; number: number; onPreview: () => void; onSaveToServer: () => void; isDownloading: boolean; username: string }) {
  const isVideo = snap.mediaType === 'mp4'
  const tl = fmtTimeLeft(snap.timeLeftSec)
  const downloadHref = buildDownloadUrl(snap, username)
  return (
    <Card className="overflow-hidden group transition-all">
      <button onClick={onPreview} className="relative block w-full bg-zinc-100 aspect-[9/16] cursor-pointer" aria-label="Previsualizar">
        {snap.previewUrl ? <img src={snap.previewUrl} alt={snap.id} className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center text-zinc-400">{isVideo ? <Film className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}</div>}
        <div className="absolute top-1 left-1 bg-black/70 text-white text-[11px] font-bold w-6 h-6 rounded flex items-center justify-center">{number}</div>
        <div className="absolute top-1 right-1 bg-black/60 text-white text-[9px] px-1 py-0.5 rounded inline-flex items-center gap-1">{isVideo ? <><Film className="w-2.5 h-2.5" /> MP4</> : <><ImageIcon className="w-2.5 h-2.5" /> JPG</>}</div>
        {isVideo && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="bg-black/40 rounded-full p-2"><Play className="w-5 h-5 text-white fill-white" /></div></div>}
        {snap.timeLeftSec !== null && <div className={`absolute bottom-1 right-1 text-[9px] px-1 py-0.5 rounded ${tl.severity === 'expired' ? 'bg-red-600 text-white' : tl.severity === 'soon' ? 'bg-orange-500 text-white' : 'bg-black/60 text-white'}`}><Clock className="w-2.5 h-2.5 inline mr-0.5" />{tl.text}</div>}
      </button>
      <CardContent className="p-1.5 grid grid-cols-2 gap-1">
        <Button size="sm" variant="outline" onClick={onSaveToServer} disabled={isDownloading} className="h-7 text-[10px] px-1 border-zinc-300 hover:bg-zinc-100">{isDownloading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <HardDriveDownload className="w-3 h-3 mr-1" />} Servidor</Button>
        <Button asChild size="sm" variant="outline" className="h-7 text-[10px] px-1 border-zinc-300 hover:bg-zinc-100"><a href={downloadHref} download><Download className="w-3 h-3 mr-1" /> Descargar</a></Button>
      </CardContent>
    </Card>
  )
}

function HistorySnapCard({ snap, number, username, onPreview }: { snap: SavedSnapLink; number: number; username: string; onPreview: () => void }) {
  const isVideo = snap.mediaType === 'mp4'
  const tl = fmtTimeLeft(snap.timeLeftSec)
  const hasFile = !!snap.localPath
  const downloadHref = buildDownloadUrl({ mediaUrl: snap.originalUrl, mediaType: snap.mediaType, timestampSec: snap.timestampSec, isoDate: snap.isoDate }, username)
  return (
    <Card className={`overflow-hidden group transition-all ${tl.severity === 'expired' && !hasFile ? 'opacity-60' : ''}`}>
      <button onClick={onPreview} className="relative block w-full bg-zinc-100 aspect-[9/16] cursor-pointer" aria-label="Previsualizar">
        {snap.previewUrl ? <img src={snap.previewUrl} alt={snap.snapId || 'snap'} className="w-full h-full object-cover" loading="lazy" /> : hasFile ? <img src={snap.localPath!} alt={snap.snapId || 'snap'} className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center text-zinc-400">{isVideo ? <Film className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}</div>}
        <div className="absolute top-1 left-1 bg-black/70 text-white text-[11px] font-bold w-6 h-6 rounded flex items-center justify-center">{number}</div>
        <div className="absolute top-1 right-1 bg-black/60 text-white text-[9px] px-1 py-0.5 rounded inline-flex items-center gap-1">{isVideo ? <><Film className="w-2.5 h-2.5" /> MP4</> : <><ImageIcon className="w-2.5 h-2.5" /> JPG</>}</div>
        <div className="absolute top-7 right-1">{hasFile ? <Badge className="bg-green-500 text-white text-[9px] h-4 px-1 hover:bg-green-500"><CheckCircle2 className="w-2.5 h-2.5 mr-0.5" /> server</Badge> : <Badge variant="secondary" className="text-[9px] h-4 px-1"><LinkIcon className="w-2.5 h-2.5 mr-0.5" /> enlace</Badge>}</div>
        {isVideo && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="bg-black/40 rounded-full p-2"><Play className="w-5 h-5 text-white fill-white" /></div></div>}
        {snap.timeLeftSec !== null && <div className={`absolute bottom-1 right-1 text-[9px] px-1 py-0.5 rounded ${tl.severity === 'expired' ? 'bg-red-600 text-white' : tl.severity === 'soon' ? 'bg-orange-500 text-white' : 'bg-black/60 text-white'}`}>{tl.text}</div>}
      </button>
      <CardContent className="p-1.5 grid grid-cols-2 gap-1">
        <Button asChild size="sm" variant="outline" className="h-7 text-[10px] px-1 border-zinc-300 hover:bg-zinc-100"><a href={snap.originalUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3 h-3 mr-1" /> Abrir</a></Button>
        <Button asChild size="sm" variant="outline" className="h-7 text-[10px] px-1 border-zinc-300 hover:bg-zinc-100"><a href={downloadHref} download><Download className="w-3 h-3 mr-1" /> Descargar</a></Button>
      </CardContent>
    </Card>
  )
}
