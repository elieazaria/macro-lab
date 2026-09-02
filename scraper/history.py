"""
history.py
----------
Récupère l'historique complet des prix (plusieurs années) pour chaque
actif suivi (or, EUR/USD, bitcoin, S&P 500, CAC 40), afin d'alimenter le
graphique interactif du dashboard avec sélecteur de plage — 5 jours,
1 mois, 1 an, 5 ans, 10 ans, Max — dans l'esprit de or.fr/cours/or.

Contrairement à predict.py (qui n'a besoin que de ~90 jours pour ajuster
un ARIMA), ce module vise le **maximum d'historique disponible sur
Stooq** (plusieurs années) en un seul fetch : c'est le frontend qui
tranche ensuite la plage affichée (voir public/js/app.js), pas besoin de
refaire une requête par plage.

Source : Stooq exclusivement (yfinance n'est pas fiable pour du long
historique depuis les runners GitHub Actions, voir predict.py).
"""

from __future__ import annotations

import io
import json
import logging
from datetime import datetime, timezone

import pandas as pd
import requests

from .config import PUBLIC_DATA_DIR, TICKERS
from .predict import STOOQ_FALLBACK

log = logging.getLogger("history")

HISTORY_FILE = PUBLIC_DATA_DIR / "history.json"
REQUEST_TIMEOUT = 15
MIN_POINTS = 30


def _fetch_full_history(symbol: str) -> pd.Series | None:
    """Télécharge l'historique quotidien complet disponible sur Stooq
    pour un symbole donné (généralement plusieurs années)."""
    url = f"https://stooq.com/q/d/l/?s={symbol}&i=d"
    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        df = pd.read_csv(io.StringIO(resp.text))
        if df.empty or "Close" not in df.columns or "Date" not in df.columns:
            return None
        df["Date"] = pd.to_datetime(df["Date"])
        df = df.set_index("Date").sort_index()
        series = df["Close"].dropna()
        if len(series) < MIN_POINTS:
            return None
        return series
    except Exception as exc:
        log.warning("Echec récupération historique Stooq pour %s: %s", symbol, exc)
        return None


def run_history_fetch() -> dict:
    """Récupère l'historique complet de tous les tickers suivis et écrit
    public/data/history.json. Si un ticker échoue, il est simplement
    absent du payload (le fichier existant n'est écrasé QUE si au moins
    un ticker a réussi, pour éviter de perdre des données valides)."""
    series_by_label: dict[str, dict] = {}
    failures: dict[str, str] = {}

    for label, ticker in TICKERS.items():
        symbol = STOOQ_FALLBACK.get(ticker)
        if not symbol:
            failures[label] = "pas de symbole Stooq configuré"
            continue

        series = _fetch_full_history(symbol)
        if series is None:
            failures[label] = "historique Stooq indisponible"
            continue

        series_by_label[label] = {
            "ticker": ticker,
            "dates": [d.strftime("%Y-%m-%d") for d in series.index],
            "close": [round(float(v), 5) for v in series.to_numpy()],
        }

    if not series_by_label:
        log.error(
            "Aucun historique récupéré (échecs: %s). history.json n'est pas écrasé.",
            failures,
        )
        return {"series": {}, "failures": failures, "skipped_write": True}

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "series": series_by_label,
        "failures": failures,
        "source": "Stooq (stooq.com)",
    }

    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    HISTORY_FILE.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    log.info(
        "Historique des prix écrit: %s (%d/%d tickers, échecs: %s)",
        HISTORY_FILE, len(series_by_label), len(TICKERS), list(failures) or "aucun",
    )
    return payload
