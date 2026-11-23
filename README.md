# Multi Saver

Descarga medios de múltiples redes sociales desde una sola interfaz.

## Redes soportadas

- **Snapchat**: Historias de 24h (solo stories, sin highlights/spotlight)
- **TikTok**: Videos, fotos y perfiles (sin marca de agua, HD)
- **Instagram**: Posts, reels, fotos y perfiles (via snapsave.app)

## Stack

- Next.js 16 + TypeScript + Tailwind CSS + shadcn/ui
- Prisma + PostgreSQL (Neon)
- Headless browser (agent-browser) para Instagram
- ffprobe para detección de calidad de video

## Configuración

1. `cp .env.example .env` y poner tu `DATABASE_URL` de Neon
2. `bun install`
3. `bun run db:push`
4. `bun run dev`

## Notas

- Snapchat migró a Next.js 13+ (flight data). El scraper maneja ambos formatos.
- TikTok usa tikwm.com como API tercera.
- Instagram usa snapsave.app: POST + decode JS ofuscado.
- Los timestamps individuales de Snapchat se extraen del parámetro `mo` de la URL del CDN.
