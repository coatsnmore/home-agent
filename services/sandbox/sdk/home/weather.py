"""Outdoor weather client for programmatic tool execution via Open-Meteo."""

import os
from typing import Any, Dict, Optional
import httpx

WMO_WEATHER_CODES = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


class WeatherClient:
    """Client for querying outdoor weather data."""

    def __init__(self, timeout: float = 8.0):
        self.timeout = timeout

    def get_weather(
        self,
        location: Optional[str] = None,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Fetch current weather and daily forecast in Fahrenheit."""
        with httpx.Client(timeout=self.timeout) as client:
            lat = latitude
            lon = longitude
            city = location or "Home"

            if lat is None or lon is None:
                if location and location.strip():
                    geo_url = (
                        f"https://geocoding-api.open-meteo.com/v1/search?"
                        f"name={location.strip()}&count=1&language=en&format=json"
                    )
                    geo_res = client.get(geo_url).json()
                    results = geo_res.get("results")
                    if results and len(results) > 0:
                        first = results[0]
                        lat = first.get("latitude")
                        lon = first.get("longitude")
                        city = f"{first.get('name')}, {first.get('admin1', '')}".strip(", ")
                else:
                    # IP Geolocation fallback
                    try:
                        ip_info = client.get("https://ipapi.co/json/").json()
                        lat = ip_info.get("latitude")
                        lon = ip_info.get("longitude")
                        city = f"{ip_info.get('city')}, {ip_info.get('region')}"
                    except Exception:
                        lat = 39.9612
                        lon = -82.9988
                        city = "Home Area"

            weather_url = (
                f"https://api.open-meteo.com/v1/forecast?"
                f"latitude={lat}&longitude={lon}"
                f"&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m"
                f"&daily=temperature_2m_max,temperature_2m_min,precipitation_sum"
                f"&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch"
                f"&timezone=auto"
            )
            res = client.get(weather_url)
            res.raise_for_status()
            data = res.json()

            current = data.get("current", {})
            daily = data.get("daily", {})
            w_code = current.get("weather_code", 0)
            condition = WMO_WEATHER_CODES.get(w_code, "Unknown")

            return {
                "location": city,
                "latitude": lat,
                "longitude": lon,
                "temperature": current.get("temperature_2m"),
                "feels_like": current.get("apparent_temperature"),
                "humidity": current.get("relative_humidity_2m"),
                "condition": condition,
                "wind_speed_mph": current.get("wind_speed_10m"),
                "precipitation_inch": current.get("precipitation"),
                "high": (daily.get("temperature_2m_max") or [None])[0],
                "low": (daily.get("temperature_2m_min") or [None])[0],
            }


weather = WeatherClient()
