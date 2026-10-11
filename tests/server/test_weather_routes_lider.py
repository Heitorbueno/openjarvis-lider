"""Regression tests for live forecast data shape and safe city validation."""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException

from openjarvis.server import weather_routes


def test_tomorrow_selects_brazil_and_correct_city_timezone(monkeypatch):
    target = (datetime.now(ZoneInfo("America/Cuiaba")).date() + timedelta(days=1)).isoformat()
    calls = []

    def fake_download(base, query):
        calls.append((base, query))
        if "geocoding" in base:
            return {"results": [
                {"name": "Cuiaba", "country_code": "US", "latitude": 40, "longitude": -70, "timezone": "America/New_York"},
                {"name": "Cuiabá", "admin1": "Mato Grosso", "country": "Brasil",
                 "country_code": "BR", "latitude": -15.6, "longitude": -56.1,
                 "timezone": "America/Cuiaba"},
            ]}
        return {"daily": {
            "time": [target],
            "temperature_2m_min": [24.1],
            "temperature_2m_max": [36.8],
            "precipitation_probability_max": [25],
            "weather_code": [2],
        }}

    monkeypatch.setattr(weather_routes, "_download_json", fake_download)
    result = weather_routes._tomorrow("Cuiabá")
    assert result["provider"] == "Open-Meteo"
    assert result["date"] == target
    assert result["temperature_max_c"] == 36.8
    assert result["temperature_min_c"] == 24.1
    assert result["precipitation_probability_percent"] == 25
    assert result["location"]["timezone"] == "America/Cuiaba"
    assert calls[1][0] == weather_routes._FORECAST
    assert calls[1][1]["latitude"] == -15.6


def test_empty_geocoding_result_fails_instead_of_inventing_values(monkeypatch):
    monkeypatch.setattr(weather_routes, "_download_json", lambda *_: {"results": []})
    with pytest.raises(LookupError, match="Cidade"):
        weather_routes._tomorrow("Cuiabá")


@pytest.mark.asyncio
async def test_malicious_city_name_rejected_before_network():
    with pytest.raises(HTTPException) as exc:
        await weather_routes.tomorrow_weather("http://127.0.0.1/admin")
    assert exc.value.status_code == 422
