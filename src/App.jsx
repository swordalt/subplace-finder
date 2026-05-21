import './App.css'
import { useState } from 'react'

const PLACE_ID_PATTERN = /^\d+$/
const REQUEST_HEADERS = {
  Accept: 'application/json',
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

async function fetchJson(url, errorMessage) {
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
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

async function fetchFirstJson(urls, errorMessage) {
  let lastError

  for (const url of urls) {
    try {
      return await fetchJson(url, errorMessage)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError ?? new Error(errorMessage)
}

async function fetchSubplaces(placeId) {
  const encodedPlaceId = encodeURIComponent(placeId)
  const universeData = await fetchFirstJson(
    [
      `/api/roblox/universe?placeId=${encodedPlaceId}`,
      `https://apis.roproxy.com/universes/v1/places/${encodedPlaceId}/universe`,
    ],
    'Could not find a universe for that place ID',
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
        `https://develop.roproxy.com/v1/universes/${universeData.universeId}/places?${params}`,
      ],
      'Could not load subplaces for that universe',
    )

    places.push(...(placesData.data ?? []))
    cursor = placesData.nextPageCursor
  } while (cursor)

  return {
    universeId: universeData.universeId,
    places,
  }
}

async function fetchExperienceAccess(placeId) {
  const encodedPlaceId = encodeURIComponent(placeId)
  const accessData = await fetchJson(
    `/api/roblox/access?placeId=${encodedPlaceId}`,
    'Could not check whether that experience is public',
  )

  return accessData
}

async function fetchRootPlaceId(universeId) {
  const encodedUniverseId = encodeURIComponent(universeId)
  const gameData = await fetchFirstJson(
    [
      `/api/roblox/game?universeId=${encodedUniverseId}`,
      `https://games.roproxy.com/v1/games?universeIds=${encodedUniverseId}`,
    ],
    'Could not load root place details for that universe',
  )
  const rootPlaceId = gameData.data?.[0]?.rootPlaceId

  if (!rootPlaceId) {
    throw new Error(
      'Unable to determine the root place. This universe ID is likely restricted.',
    )
  }

  return rootPlaceId
}

function App() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('idle')
  const [rootStatus, setRootStatus] = useState('idle')
  const [error, setError] = useState('')
  const [rootError, setRootError] = useState('')
  const [accessWarning, setAccessWarning] = useState('')
  const [result, setResult] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setRootError('')
    setAccessWarning('')
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
      const subplaceResult = await fetchSubplaces(placeId)
      setResult({
        ...subplaceResult,
        placeId,
      })
      setStatus('success')
      setRootStatus('loading')

      try {
        const accessData = await fetchExperienceAccess(placeId)

        if (accessData.status === 302) {
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
        const rootPlaceId = await fetchRootPlaceId(subplaceResult.universeId)
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

  return (
    <main className="app-shell">
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
                        <a className="join-link" href={`roblox://placeId=${place.id}`}>
                          Join
                        </a>
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
