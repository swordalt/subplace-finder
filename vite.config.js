import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const robloxHeaders = {
  accept: 'application/json',
  origin: 'https://www.roblox.com',
  referer: 'https://www.roblox.com/',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
}

function getRobloxRoute(requestUrl) {
  const pathname = requestUrl.pathname.replace(/\/+$/, '')
  const routePath = pathname.replace(/^\/api\/roblox/, '') || '/'

  return routePath.replace(/\/+$/, '') || '/'
}

async function handleRobloxProxy(request, response) {
  try {
    const requestUrl = new URL(request.url, 'http://localhost')
    const routePath = getRobloxRoute(requestUrl)
    let targetUrl
    let fallbackUrl

    if (routePath === '/universe') {
      const placeId = requestUrl.searchParams.get('placeId')

      if (!/^\d+$/.test(placeId ?? '')) {
        response.statusCode = 400
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ error: 'A numeric placeId is required.' }))
        return
      }

      targetUrl = `https://apis.roblox.com/universes/v1/places/${placeId}/universe`
      fallbackUrl = `https://apis.roproxy.com/universes/v1/places/${placeId}/universe`
    } else if (routePath === '/places') {
      const universeId = requestUrl.searchParams.get('universeId')

      if (!/^\d+$/.test(universeId ?? '')) {
        response.statusCode = 400
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ error: 'A numeric universeId is required.' }))
        return
      }

      const params = new URLSearchParams({
        limit: requestUrl.searchParams.get('limit') ?? '100',
        sortOrder: requestUrl.searchParams.get('sortOrder') ?? 'Asc',
      })
      const cursor = requestUrl.searchParams.get('cursor')

      if (cursor) {
        params.set('cursor', cursor)
      }

      targetUrl = `https://develop.roblox.com/v1/universes/${universeId}/places?${params}`
      fallbackUrl = `https://develop.roproxy.com/v1/universes/${universeId}/places?${params}`
    } else if (
      routePath === '/access' ||
      routePath === '/accessibility' ||
      routePath === '/status'
    ) {
      const placeId = requestUrl.searchParams.get('placeId')

      if (!/^\d+$/.test(placeId ?? '')) {
        response.statusCode = 400
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ error: 'A numeric placeId is required.' }))
        return
      }

      const gamePageResponse = await fetch(`https://www.roblox.com/games/${placeId}`, {
        headers: robloxHeaders,
        redirect: 'manual',
      })

      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          status: gamePageResponse.status,
          accessible: gamePageResponse.status === 200,
        }),
      )
      return
    } else if (routePath === '/game' || routePath === '/games') {
      const universeId = requestUrl.searchParams.get('universeId')

      if (!/^\d+$/.test(universeId ?? '')) {
        response.statusCode = 400
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ error: 'A numeric universeId is required.' }))
        return
      }

      targetUrl = `https://games.roblox.com/v1/games?universeIds=${universeId}`
      fallbackUrl = `https://games.roproxy.com/v1/games?universeIds=${universeId}`
    } else {
      response.statusCode = 404
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ error: 'Unknown Roblox API route.' }))
      return
    }

    let robloxResponse = await fetch(targetUrl, { headers: robloxHeaders })

    if (!robloxResponse.ok && fallbackUrl) {
      robloxResponse = await fetch(fallbackUrl, { headers: robloxHeaders })
    }

    const body = await robloxResponse.text()

    response.statusCode = robloxResponse.status
    response.setHeader(
      'content-type',
      robloxResponse.headers.get('content-type') ?? 'application/json',
    )
    response.end(body)
  } catch {
    response.statusCode = 502
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ error: 'Roblox request failed.' }))
  }
}

function robloxProxyPlugin() {
  return {
    name: 'roblox-proxy',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.startsWith('/api/roblox')) {
          handleRobloxProxy(request, response)
          return
        }

        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.startsWith('/api/roblox')) {
          handleRobloxProxy(request, response)
          return
        }

        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), robloxProxyPlugin()],
})
