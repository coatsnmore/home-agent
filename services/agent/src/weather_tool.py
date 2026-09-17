"""Outdoor weather tool using Open-Meteo and client IP geolocation."""

import time
from typing import Optional
import httpx
from strands import tool

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


@tool
def get_outside_weather(
    location: Optional[str] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
) -> str:
    """Get the current weather outside, including temperature, conditions, feels-like, humidity, wind, and today's high/low.

    Args:
        location: City or place name (e.g. 'Columbus, Ohio' or 'Miami'). If not provided, infers from the home client's location.
        latitude: Optional latitude coordinate.
        longitude: Optional longitude coordinate.
    """
    resolved_location = location or "Home"
    start_time = time.perf_counter()

    try:
        if latitude is None or longitude is None:
            if location and location.strip():
                # Geocode location using Open-Meteo Geocoding API
                geo_url = f"https://geocoding-api.open-meteo.com/v1/search?name={location.strip()}&count=1&language=en&format=json"
                with httpx.Client(timeout=6.0) as client:
                    geo_res = client.get(geo_url).json()

                results = geo_res.get("results")
                if results and len(results) > 0:
                    first = results[0]
                    latitude = float(first["latitude"])
                    longitude = float(first["longitude"])
                    name = first.get("name", location)
                    admin = first.get("admin1", "")
                    country = first.get("country", "")
                    resolved_location = f"{name}, {admin}" if admin else f"{name}, {country}"
                else:
                    return f"Could not find coordinates for location: '{location}'. Please verify the city or state name."
            else:
                # Infer home client location using fast IP geolocation
                with httpx.Client(timeout=6.0) as client:
                    ip_res = client.get("https://get.geojs.io/v1/ip/geo.json").json()
                latitude = float(ip_res["latitude"])
                longitude = float(ip_res["longitude"])
                city = ip_res.get("city", "Home")
                region = ip_res.get("region", "")
                resolved_location = f"{city}, {region}" if region else city

        # Query Open-Meteo forecast API in Fahrenheit / mph
        weather_url = (
            f"https://api.open-meteo.com/v1/forecast?"
            f"latitude={latitude}&longitude={longitude}&"
            f"current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&"
            f"daily=temperature_2m_max,temperature_2m_min&"
            f"temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto"
        )

        with httpx.Client(timeout=6.0) as client:
            data = client.get(weather_url).json()

        curr = data.get("current", {})
        daily = data.get("daily", {})

        temp = curr.get("temperature_2m")
        feels = curr.get("apparent_temperature")
        humidity = curr.get("relative_humidity_2m")
        wind = curr.get("wind_speed_10m")
        code = curr.get("weather_code", 0)
        condition = WMO_WEATHER_CODES.get(code, "Clear")

        highs = daily.get("temperature_2m_max", [])
        lows = daily.get("temperature_2m_min", [])
        high = highs[0] if highs else None
        low = lows[0] if lows else None

        high_str = f"{high}°F" if high is not None else "N/A"
        low_str = f"{low}°F" if low is not None else "N/A"

        response = (
            f"The current weather in {resolved_location} is {temp}°F and {condition}, with a feels-like temperature of {feels}°F. "
            f"Today's forecast has a high of {high_str} and a low of {low_str}, with humidity at {humidity}% and wind speeds around {wind} mph.\n\n"
            f"| Metric | Value |\n"
            f"| --- | --- |\n"
            f"| Condition | {condition} |\n"
            f"| Temperature | {temp}°F |\n"
            f"| Feels Like | {feels}°F |\n"
            f"| Today's High | {high_str} |\n"
            f"| Today's Low | {low_str} |\n"
            f"| Humidity | {humidity}% |\n"
            f"| Wind Speed | {wind} mph |"
        )

        return response

    except Exception as e:
        return f"Unable to fetch weather for {resolved_location}: {str(e)}"
