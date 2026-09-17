import { useState, useEffect } from 'react'

/**
 * Hook to detect the web client's location via IP geolocation.
 * Provides city, region, coordinates for outdoor weather and local context.
 */
export function useLocation() {
  const [location, setLocation] = useState(() => {
    try {
      const cached = localStorage.getItem('home_agent_client_location')
      return cached ? JSON.parse(cached) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(!location)
  const [error, setError] = useState(null)

  useEffect(() => {
    let isMounted = true

    const detectLocation = async () => {
      try {
        const res = await fetch('https://get.geojs.io/v1/ip/geo.json')
        if (!res.ok) throw new Error(`Geo lookup failed: ${res.status}`)
        const data = await res.json()

        const locData = {
          city: data.city || 'Home',
          region: data.region || '',
          country: data.country || '',
          latitude: parseFloat(data.latitude),
          longitude: parseFloat(data.longitude),
          displayName: data.region ? `${data.city}, ${data.region}` : data.city || 'Local'
        }

        if (isMounted) {
          setLocation(locData)
          setLoading(false)
          localStorage.setItem('home_agent_client_location', JSON.stringify(locData))
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message)
          setLoading(false)
        }
      }
    }

    detectLocation()

    return () => {
      isMounted = false
    }
  }, [])

  return { location, loading, error }
}
