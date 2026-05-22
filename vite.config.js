import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const robloxHeaders = {
  accept: 'application/json',
  origin: 'https://www.roblox.com',
  referer: 'https://www.roblox.com',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
}

function readHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function normalizeRobloxSecurityToken(value = '') {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return ''
  }

  const cookieMatch = trimmedValue.match(/(?:^|;\s*)\.ROBLOSECURITY=([^;]+)/i)

  if (cookieMatch) {
    return cookieMatch[1].trim()
  }

  return trimmedValue
    .replace(/^cookie:\s*/i, '')
    .replace(/^\.ROBLOSECURITY=/i, '')
    .trim()
}

function getRobloxHeaders(request, targetUrl, csrfToken = '') {
  const headers = { ...robloxHeaders }
  const robloxSecurityToken = normalizeRobloxSecurityToken(
    readHeaderValue(request.headers['x-roblox-security']),
  )

  if (robloxSecurityToken && new URL(targetUrl).hostname.endsWith('roblox.com')) {
    headers.cookie = `.ROBLOSECURITY=${robloxSecurityToken}`
  }

  if (csrfToken) {
    headers['x-csrf-token'] = csrfToken
  }

  return headers
}

async function fetchRoblox(request, targetUrl, options = {}) {
  const headers = {
    ...getRobloxHeaders(request, targetUrl),
    ...options.headers,
  }
  let robloxResponse = await fetch(targetUrl, {
    ...options,
    headers,
  })

  if (robloxResponse.status === 403) {
    const csrfToken = robloxResponse.headers.get('x-csrf-token')

    if (csrfToken) {
      robloxResponse = await fetch(targetUrl, {
        ...options,
        headers: {
          ...headers,
          'x-csrf-token': csrfToken,
        },
      })
    }
  }

  return robloxResponse
}

async function fetchRobloxFollowingRedirects(request, targetUrl, options = {}) {
  let currentUrl = targetUrl
  let robloxResponse

  for (let redirectCount = 0; redirectCount < 5; redirectCount += 1) {
    robloxResponse = await fetchRoblox(request, currentUrl, {
      ...options,
      redirect: 'manual',
    })

    if (![301, 302, 303, 307, 308].includes(robloxResponse.status)) {
      return robloxResponse
    }

    const location = robloxResponse.headers.get('location')

    if (!location) {
      return robloxResponse
    }

    currentUrl = new URL(location, currentUrl).toString()
  }

  return robloxResponse
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
      fallbackUrl = `https://apis.rotunnel.com/universes/v1/places/${placeId}/universe`
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
      fallbackUrl = `https://develop.rotunnel.com/v1/universes/${universeId}/places?${params}`
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

      const targetUrl = `https://www.roblox.com/games/${placeId}`
      const gamePageResponse = await fetchRobloxFollowingRedirects(request, targetUrl)

      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          status: gamePageResponse.status,
          accessible: gamePageResponse.ok,
          redirected: gamePageResponse.redirected,
          url: gamePageResponse.url,
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
      fallbackUrl = `https://games.rotunnel.com/v1/games?universeIds=${universeId}`
    } else if (
      routePath === '/place-details' ||
      routePath === '/games/multiget-place-details' ||
      routePath === '/v1/games/multiget-place-details' ||
      routePath.endsWith('/multiget-place-details')
    ) {
      const placeId =
        requestUrl.searchParams.get('placeId') ?? requestUrl.searchParams.get('placeIds')

      if (!/^\d+$/.test(placeId ?? '')) {
        response.statusCode = 400
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ error: 'A numeric placeId or placeIds value is required.' }))
        return
      }

      targetUrl = `https://games.roblox.com/v1/games/multiget-place-details?placeIds=${placeId}`

      const placeDetailsResponse = await fetchRoblox(request, targetUrl)

      if (!placeDetailsResponse.ok) {
        response.statusCode = 200
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify([{ placeId: Number(placeId), isPlayable: false }]))
        return
      }

      const body = await placeDetailsResponse.text()

      response.statusCode = placeDetailsResponse.status
      response.setHeader(
        'content-type',
        placeDetailsResponse.headers.get('content-type') ?? 'application/json',
      )
      response.end(body)
      return
    } else {
      response.statusCode = 404
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ error: 'Unknown Roblox API route.' }))
      return
    }

    let robloxResponse = await fetchRoblox(request, targetUrl)

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
