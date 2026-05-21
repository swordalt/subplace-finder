import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const host = 'localhost'
const port = 4173
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const distRoot = resolve(root, 'dist')
const url = `http://${host}:${port}/`
const isWindows = process.platform === 'win32'

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const robloxHeaders = {
  accept: 'application/json',
  origin: 'https://www.roblox.com',
  referer: 'https://www.roblox.com/',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
}

function npmProcessArgs(args) {
  if (!isWindows) {
    return {
      command: 'npm',
      args,
    }
  }

  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', `npm ${args.join(' ')}`],
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function getRobloxRoute(requestUrl) {
  return requestUrl.pathname
    .replace(/\/+$/, '')
    .replace(/^\/api\/roblox/, '') || '/'
}

async function proxyRoblox(request, response, requestUrl) {
  const routePath = getRobloxRoute(requestUrl)
  let targetUrl
  let fallbackUrl

  if (routePath === '/universe') {
    const placeId = requestUrl.searchParams.get('placeId')

    if (!/^\d+$/.test(placeId ?? '')) {
      sendJson(response, 400, { error: 'A numeric placeId is required.' })
      return
    }

    targetUrl = `https://apis.roblox.com/universes/v1/places/${placeId}/universe`
    fallbackUrl = `https://apis.roproxy.com/universes/v1/places/${placeId}/universe`
  } else if (routePath === '/places') {
    const universeId = requestUrl.searchParams.get('universeId')

    if (!/^\d+$/.test(universeId ?? '')) {
      sendJson(response, 400, { error: 'A numeric universeId is required.' })
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
      sendJson(response, 400, { error: 'A numeric placeId is required.' })
      return
    }

    try {
      const gamePageResponse = await fetch(`https://www.roblox.com/games/${placeId}`, {
        headers: robloxHeaders,
        redirect: 'manual',
      })

      sendJson(response, 200, {
        status: gamePageResponse.status,
        accessible: gamePageResponse.status === 200,
      })
    } catch {
      sendJson(response, 502, { error: 'Roblox accessibility check failed.' })
    }

    return
  } else if (routePath === '/game' || routePath === '/games') {
    const universeId = requestUrl.searchParams.get('universeId')

    if (!/^\d+$/.test(universeId ?? '')) {
      sendJson(response, 400, { error: 'A numeric universeId is required.' })
      return
    }

    targetUrl = `https://games.roblox.com/v1/games?universeIds=${universeId}`
    fallbackUrl = `https://games.roproxy.com/v1/games?universeIds=${universeId}`
  } else {
    sendJson(response, 404, { error: 'Unknown Roblox API route.' })
    return
  }

  try {
    let robloxResponse = await fetch(targetUrl, { headers: robloxHeaders })

    if (!robloxResponse.ok && fallbackUrl) {
      robloxResponse = await fetch(fallbackUrl, { headers: robloxHeaders })
    }

    const body = await robloxResponse.text()

    response.writeHead(robloxResponse.status, {
      'content-type': robloxResponse.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    })
    response.end(body)
  } catch {
    sendJson(response, 502, { error: 'Roblox request failed.' })
  }
}

function serveStatic(request, response, requestUrl) {
  const pathname = decodeURIComponent(requestUrl.pathname)
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1)
  let filePath = resolve(join(distRoot, relativePath))

  if (!filePath.startsWith(distRoot)) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }

  if (!existsSync(filePath)) {
    filePath = resolve(distRoot, 'index.html')
  }

  response.writeHead(200, {
    'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
  })
  createReadStream(filePath).pipe(response)
}

const buildCommand = npmProcessArgs(['run', 'build'])

const build = spawnSync(buildCommand.command, buildCommand.args, {
  stdio: 'inherit',
})

if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, url)

  if (requestUrl.pathname.startsWith('/api/roblox')) {
    await proxyRoblox(request, response, requestUrl)
    return
  }

  serveStatic(request, response, requestUrl)
})

server.listen(port, host, () => {
  console.log(`Hosting Subplace Finder at ${url}`)
})
