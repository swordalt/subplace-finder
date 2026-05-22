import './App.css'
import { useState } from 'react'

const PLACE_ID_PATTERN = /^\d+$/
const AUTH_TOKEN_STORAGE_KEY = 'subplaceFinder.authToken'
const REQUEST_HEADERS = {
  Accept: 'application/json',
}

function getStoredAuthToken() {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ?? ''
}

function buildRequestHeaders(url, authToken, headers = {}) {
  const requestHeaders = {
    ...REQUEST_HEADERS,
    ...headers,
  }
  const trimmedToken = authToken.trim()

  if (trimmedToken && url.startsWith('/api/roblox')) {
    requestHeaders['X-Roblox-Security'] = trimmedToken
  }

  return requestHeaders
}

function parsePlaceId(value) {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    throw new Error('Enter a Roblox place ID or experience URL.')
  }

  if (PLACE_ID_PATTERN.test(trimmedValue)) {
    return trimmedValue
  }

  let url

  try {
    url = new URL(trimmedValue)
  } catch {
    throw new Error('Enter a valid Roblox URL or numeric place ID.')
  }

  const gamesMatch = url.pathname.match(/\/games\/(\d+)/i)

  if (gamesMatch) {
    return gamesMatch[1]
  }

  const pathId = url.pathname
    .split('/')
    .find((part) => PLACE_ID_PATTERN.test(part))

  if (pathId) {
    return pathId
  }

  throw new Error('Could not find a place ID in that URL.')
}

async function fetchJson(url, errorMessage, authToken = '', options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: buildRequestHeaders(url, authToken, options.headers),
  })
  const contentType = response.headers.get('content-type') ?? ''

  if (!response.ok) {
    throw new Error(`${errorMessage} (${response.status})`)
  }

  if (!contentType.includes('application/json')) {
    throw new Error('The lookup route returned the app instead of API data.')
  }

  return response.json()
}

async function fetchFirstJson(urls, errorMessage, authToken = '', options = {}) {
  let lastError

  for (const url of urls) {
    try {
      return await fetchJson(url, errorMessage, authToken, options)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError ?? new Error(errorMessage)
}

async function fetchSubplaces(placeId, authToken) {
  const encodedPlaceId = encodeURIComponent(placeId)
  const universeData = await fetchFirstJson(
    [
      `/api/roblox/universe?placeId=${encodedPlaceId}`,
      `https://apis.rotunnel.com/universes/v1/places/${encodedPlaceId}/universe`,
    ],
    'Could not find a universe for that place ID',
    authToken,
  )

  if (!universeData.universeId) {
    throw new Error('Roblox did not return a universe ID for that place.')
  }

  const places = []
  let cursor = null

  do {
    const params = new URLSearchParams({
      limit: '100',
      sortOrder: 'Asc',
    })

    if (cursor) {
      params.set('cursor', cursor)
    }

    const proxyParams = new URLSearchParams(params)
    proxyParams.set('universeId', universeData.universeId)

    const placesData = await fetchFirstJson(
      [
        `/api/roblox/places?${proxyParams}`,
        `https://develop.rotunnel.com/v1/universes/${universeData.universeId}/places?${params}`,
      ],
      'Could not load subplaces for that universe',
      authToken,
    )

    places.push(...(placesData.data ?? []))
    cursor = placesData.nextPageCursor
  } while (cursor)

  return {
    universeId: universeData.universeId,
    places,
  }
}

async function fetchExperienceAccess(placeId, authToken) {
  const encodedPlaceId = encodeURIComponent(placeId)
  const accessData = await fetchJson(
    `/api/roblox/access?placeId=${encodedPlaceId}`,
    'Could not check whether that experience is public',
    authToken,
  )

  return accessData
}

async function fetchRootPlaceId(universeId, authToken) {
  const encodedUniverseId = encodeURIComponent(universeId)
  const gameData = await fetchFirstJson(
    [
      `/api/roblox/game?universeId=${encodedUniverseId}`,
      `https://games.rotunnel.com/v1/games?universeIds=${encodedUniverseId}`,
    ],
    'Could not load root place details for that universe',
    authToken,
  )
  const rootPlaceId = gameData.data?.[0]?.rootPlaceId

  if (!rootPlaceId) {
    throw new Error(
      'Unable to determine the root place. This universe ID is likely restricted.',
    )
  }

  return rootPlaceId
}

async function fetchPlacePlayability(placeId, authToken) {
  const encodedPlaceId = encodeURIComponent(placeId)
  const placeDetails = await fetchJson(
    `/api/roblox/v1/games/multiget-place-details?placeIds=${encodedPlaceId}`,
    'Could not check whether that subplace is joinable',
    authToken,
  )
  const details = Array.isArray(placeDetails) ? placeDetails[0] : placeDetails.data?.[0]

  return Boolean(details?.isPlayable)
}

function App() {
  const [query, setQuery] = useState('')
  const [authToken, setAuthToken] = useState(getStoredAuthToken)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [status, setStatus] = useState('idle')
  const [rootStatus, setRootStatus] = useState('idle')
  const [error, setError] = useState('')
  const [rootError, setRootError] = useState('')
  const [accessWarning, setAccessWarning] = useState('')
  const [joinStates, setJoinStates] = useState({})
  const [result, setResult] = useState(null)

  function handleAuthTokenChange(event) {
    const nextToken = event.target.value

    setAuthToken(nextToken)
    setJoinStates({})
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, nextToken)
  }

  async function handleJoinCheck(placeId) {
    if (!authToken.trim()) {
      return
    }

    const currentState = joinStates[placeId]?.status

    if (currentState === 'checking' || currentState === 'playable' || currentState === 'locked') {
      return
    }

    setJoinStates((currentStates) => ({
      ...currentStates,
      [placeId]: { status: 'checking' },
    }))

    try {
      const isPlayable = await fetchPlacePlayability(placeId, authToken)
      setJoinStates((currentStates) => ({
        ...currentStates,
        [placeId]: { status: isPlayable ? 'playable' : 'locked' },
      }))
    } catch {
      setJoinStates((currentStates) => ({
        ...currentStates,
        [placeId]: { status: 'locked' },
      }))
    }
  }

  function handleJoin(placeId) {
    window.location.href = `roblox://placeId=${placeId}`
  }

  function getJoinLabel(placeId) {
    if (!authToken.trim()) {
      return 'Join'
    }

    const state = joinStates[placeId]?.status

    if (state === 'checking') {
      return 'Checking'
    }

    if (state === 'playable') {
      return 'Join'
    }

    if (state === 'locked') {
      return 'Locked'
    }

    return 'Check'
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setRootError('')
    setAccessWarning('')
    setJoinStates({})
    setResult(null)
    setRootStatus('idle')

    let placeId

    try {
      placeId = parsePlaceId(query)
    } catch (parseError) {
      setStatus('error')
      setError(parseError.message)
      return
    }

    setStatus('loading')

    try {
      const subplaceResult = await fetchSubplaces(placeId, authToken)
      setResult({
        ...subplaceResult,
        placeId,
      })
      setStatus('success')
      setRootStatus('loading')

      try {
        const accessData = await fetchExperienceAccess(placeId, authToken)

        if (!accessData.accessible) {
          setAccessWarning(
            `Status ${accessData.status} instead of 200; this game may be restricted or inaccessible.`,
          )
        }
      } catch {
        setAccessWarning(
          'The experience accessibility check could not be completed.',
        )
      }

      try {
        const rootPlaceId = await fetchRootPlaceId(subplaceResult.universeId, authToken)
        setResult((currentResult) => ({
          ...currentResult,
          rootPlaceId,
        }))
        setRootStatus('success')
      } catch (rootRequestError) {
        setRootStatus('error')
        setRootError(
          rootRequestError.message ||
            'Subplaces loaded, but the root place could not be identified.',
        )
      }
    } catch (requestError) {
      setStatus('error')
      setRootStatus('idle')
      setError(
        requestError.message ||
          'Something went wrong while talking to Roblox. Try again in a moment.',
      )
    }
  }

  const isLoading = status === 'loading'
  const hasPlaces = result?.places?.length > 0
  const hasAuthToken = authToken.trim().length > 0

  return (
    <main className="app-shell">
      <div className="settings-area">
        <button
          className="settings-button"
          type="button"
          aria-label="Open settings"
          aria-expanded={isSettingsOpen}
          aria-controls="settings-menu"
          onClick={() => setIsSettingsOpen((currentValue) => !currentValue)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M19.4 13.5a7.8 7.8 0 0 0 .1-1.5 7.8 7.8 0 0 0-.1-1.5l2-1.5-2-3.5-2.4 1a8.3 8.3 0 0 0-2.6-1.5L14 2.4h-4L9.6 5a8.3 8.3 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a7.8 7.8 0 0 0-.1 1.5 7.8 7.8 0 0 0 .1 1.5l-2 1.5 2 3.5 2.4-1a8.3 8.3 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a8.3 8.3 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
          </svg>
        </button>

        {isSettingsOpen && (
          <section
            className="settings-menu"
            id="settings-menu"
            aria-labelledby="settings-title"
          >
            <h2 id="settings-title">Settings</h2>
            <div className="settings-field">
              <label htmlFor="auth-token">Authentication</label>
              <input
                id="auth-token"
                type="password"
                value={authToken}
                onChange={handleAuthTokenChange}
                placeholder=".ROBLOSECURITY token"
                autoComplete="off"
              />
              <p>
                Used as the .ROBLOSECURITY cookie for Roblox API requests when
                applicable. This value stays in your browser.
              </p>
            </div>
          </section>
        )}
      </div>

      <section className="search-view" aria-labelledby="app-title">
        <div className="intro">
          <h1 id="app-title">Subplace Finder</h1>
          <p className="summary">
            Find Roblox subplaces from a game ID or experience URL.
          </p>
        </div>

        <form className="search-form" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="game-search">
            Input Roblox game ID or URL
          </label>
          <div className="search-field">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="search-icon"
            >
              <path d="m20.4 21.8-6.1-6.1a8.2 8.2 0 1 1 1.4-1.4l6.1 6.1-1.4 1.4ZM9.5 15.8a6.3 6.3 0 1 0 0-12.6 6.3 6.3 0 0 0 0 12.6Z" />
            </svg>
            <input
              id="game-search"
              name="game-search"
              type="search"
              placeholder="input Roblox game ID or URL"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={isLoading}
              autoComplete="off"
            />
          </div>
          <button type="submit" aria-label="Search" disabled={isLoading}>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m9.3 17.7-1.4-1.4 4.3-4.3-4.3-4.3 1.4-1.4 5.7 5.7-5.7 5.7Z" />
            </svg>
          </button>
        </form>

        <aside className="lookup-note">
          Many games protect against direct entry into subplaces, so direct
          joining will rarely work for most games. All listed data is returned
          by Roblox and is factual.
        </aside>

        <div className="status-region" role="status" aria-live="polite">
          {isLoading && <p className="status-message">Looking up subplaces...</p>}
          {status === 'error' && <p className="error-message">{error}</p>}
          {status === 'success' && !hasPlaces && (
            <p className="status-message">
              Universe {result.universeId} did not return any places.
            </p>
          )}
          {status === 'success' && hasPlaces && rootStatus === 'loading' && (
            <p className="status-message">Identifying root place...</p>
          )}
          {status === 'success' && hasPlaces && accessWarning && (
            <p className="warning-message">{accessWarning}</p>
          )}
          {status === 'success' && hasPlaces && rootStatus === 'error' && (
            <p className="error-message">{rootError}</p>
          )}
        </div>

        {hasPlaces && (
          <section className="results" aria-labelledby="results-title">
            <div className="results-header">
              <h2 id="results-title">Subplaces</h2>
              <p>
                {result.places.length} found for universe {result.universeId}
              </p>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">ID</th>
                    <th scope="col">Join</th>
                  </tr>
                </thead>
                <tbody>
                  {result.places.map((place) => (
                    <tr
                      className={
                        place.id === result.rootPlaceId ? 'root-place-row' : undefined
                      }
                      key={place.id}
                    >
                      <td>
                        <div className="place-name-cell">
                          <span>{place.name || 'Untitled place'}</span>
                          {place.id === result.rootPlaceId && (
                            <span className="root-badge">Root Place</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <code>{place.id}</code>
                      </td>
                      <td>
                        <span
                          className="join-control"
                          onFocus={() => handleJoinCheck(place.id)}
                          onMouseEnter={() => handleJoinCheck(place.id)}
                        >
                          <button
                            className="join-button"
                            type="button"
                            disabled={
                              hasAuthToken &&
                              joinStates[place.id]?.status !== 'playable'
                            }
                            onClick={() => handleJoin(place.id)}
                          >
                            {getJoinLabel(place.id)}
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </section>
    </main>
  )
}

export default App
