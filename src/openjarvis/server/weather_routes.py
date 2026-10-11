"""Read-only Open-Meteo forecast endpoint for voice-first Jarvis PWA.

No external API keys. City lookup and forecast requests only use fixed,
well-known HTTPS hosts; arbitrary URLs are never accepted from the caller.
Failures never degrade to fabricated temperatures.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request as URLRequest, urlopen
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/v1/weather", tags=["weather"])

_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search"
_FORECAST = "https://api.open-meteo.com/v1/forecast"
_CITY_RE = re.compile(r"^[\w\s\-',.]{2,80}$", re.UNICODE)

_WEATHER_CODES_PT = {
    0: "céu limpo", 1: "predominantemente limpo",
    2: "parcialmente nublado", 3: "nublado",
    45: "neblina", 48: "neblina com geada",
    51: "garoa leve", 53: "garoa moderada", 55: "garoa intensa",
    61: "chuva leve", 63: "chuva moderada", 65: "chuva forte",
    80: "pancadas leves de chuva", 81: "pancadas de chuva",
    82: "pancadas fortes de chuva", 95: "trovoadas",
    96: "trovoadas com granizo", 99: "trovoadas com granizo",
}


def _download_json(base: str, query: dict[str, object]) -> dict:
    """Fixed-host JSON retrieval with bounded waiting and payload size."""
    url = base + "?" + urlencode(query)
    request = URLRequest(url, headers={"User-Agent": "OpenJarvis-Lider/1.0"})
    with urlopen(request, timeout=12) as response:
        if response.status != 200:
            raise ValueError("Unexpected weather provider HTTP status")
        data = response.read(512_001)
        if len(data) > 512_000:
            raise ValueError("Weather response too large")
        result = json.loads(data)
    if not isinstance(result, dict):
        raise ValueError("Unexpected weather provider response")
    return result


def _tomorrow(city: str) -> dict:
    geo = _download_json(_GEOCODE, {
        "name": city, "count": 10, "language": "pt", "format": "json",
    })
    results = geo.get("results")
    if not isinstance(results, list) or not results:
        raise LookupError("Cidade não encontrada no serviço meteorológico.")

    candidates = [item for item in results if isinstance(item, dict)]
    if not candidates:
        raise LookupError("Cidade não encontrada no serviço meteorológico.")
    # For an unqualified Brazilian city, prefer matching Brazil over other homonyms.
    selected = next(
        (item for item in candidates if item.get("country_code") == "BR"), candidates[0],
    )
    try:
        latitude = float(selected["latitude"])
        longitude = float(selected["longitude"])
        tz_name = str(selected["timezone"])
        city_name = str(selected["name"])
        local_date = datetime.now(ZoneInfo(tz_name)).date() + timedelta(days=1)
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Localidade sem coordenadas ou fuso válido") from exc

    forecast = _download_json(_FORECAST, {
        "latitude": latitude,
        "longitude": longitude,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
        "current": "temperature_2m",
        "temperature_unit": "celsius",
        "timezone": tz_name,
        "forecast_days": 4,
    })
    daily = forecast.get("daily")
    if not isinstance(daily, dict):
        raise ValueError("Dados diários indisponíveis.")
    days = daily.get("time")
    if not isinstance(days, list):
        raise ValueError("Datas da previsão indisponíveis.")
    target = local_date.isoformat()
    if target not in days:
        raise ValueError("Previsão para amanhã indisponível.")
    index = days.index(target)

    def value(field: str):
        row = daily.get(field)
        if not isinstance(row, list) or index >= len(row):
            return None
        return row[index]

    code = value("weather_code")
    return {
        "provider": "Open-Meteo",
        "source_url": "https://open-meteo.com/",
        "location": {
            "name": city_name,
            "region": selected.get("admin1"),
            "country": selected.get("country"),
            "timezone": tz_name,
        },
        "date": target,
        "temperature_max_c": value("temperature_2m_max"),
        "temperature_min_c": value("temperature_2m_min"),
        "precipitation_probability_percent": value("precipitation_probability_max"),
        "weather_code": code,
        "description_pt": _WEATHER_CODES_PT.get(code, "condições variáveis"),
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/tomorrow")
async def tomorrow_weather(
    city: str = Query(..., min_length=2, max_length=80),
):
    """Return a date-specific forecast grounded in upstream observations."""
    city = city.strip()
    if not _CITY_RE.fullmatch(city):
        raise HTTPException(status_code=422, detail="Nome de cidade inválido")
    try:
        return await asyncio.to_thread(_tomorrow, city)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (URLError, HTTPError, TimeoutError, OSError, ValueError, KeyError) as exc:
        # Do not echo provider URLs or unexpected payloads into user errors.
        raise HTTPException(
            status_code=503,
            detail="Serviço meteorológico temporariamente indisponível.",
        ) from exc
