"""
predict.py
----------
Prédiction en série temporelle par modèle ARIMA (AutoRegressive
Integrated Moving Average) pour l'or, EUR/USD, le bitcoin, le S&P 500
et le CAC 40, avec intervalle de confiance, et un léger biais post-hoc
proportionnel au climat macro détecté par le pipeline de scoring des
news (plus le climat est tendu — score élevé —, plus la projection
ARIMA est infléchie dans le sens de sa tendance déjà détectée).

Pourquoi ARIMA et pas plus lourd (Prophet, LSTM, auto_arima) ?
Le pipeline tourne gratuitement, toutes les heures, sur un runner
GitHub Actions sans GPU. ARIMA (via statsmodels) est rapide à ajuster
(quelques centaines de ms par ticker) et donne un intervalle de
confiance statistiquement interprétable, ce qu'une simple régression
linéaire ne fournit pas. Le choix d'ordre (p, d, q) est fait
automatiquement par une recherche en grille restreinte (minimisation
de l'AIC), un compromis volontaire entre qualité d'ajustement et
temps d'exécution.

Pour aller plus loin : remplacer `_fit_best_arima` par `pmdarima.auto_arima`
(recherche plus exhaustive) ou par un SARIMAX avec variables exogènes
(ex: score macro quotidien historisé) si vous conservez cet historique.
"""

from __future__ import annotations

import json
import logging
import warnings
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import yfinance as yf
from statsmodels.tsa.arima.model import ARIMA

from .config import PREDICTIONS_FILE, TICKERS

log = logging.getLogger("predict")
warnings.filterwarnings("ignore")  # statsmodels est bavard sur la convergence/dates

HORIZON_DAYS = 5
LOOKBACK_DAYS = 90        # historique plus long qu'avant pour un ARIMA stable
CI_ALPHA = 0.10            # intervalle de confiance à 90%
MIN_OBSERVATIONS = 20      # en dessous, ARIMA n'est pas fiable -> ticker ignoré

# Grille d'ordres (p, d, q) testés — volontairement restreinte pour rester
# rapide sur un runner CI. d=1 partout car les séries de prix financiers
# sont quasi toujours non-stationnaires en niveau (marche aléatoire).
CANDIDATE_ORDERS: list[tuple[int, int, int]] = [
    (1, 1, 0), (0, 1, 1), (1, 1, 1),
    (2, 1, 0), (0, 1, 2), (2, 1, 1), (1, 1, 2), (2, 1, 2),
]


def _fetch_prices(ticker: str) -> pd.Series | None:
    """Récupère la série de clôtures quotidiennes des `LOOKBACK_DAYS`
    derniers jours pour un ticker Yahoo Finance donné."""
    try:
        hist = yf.Ticker(ticker).history(period=f"{LOOKBACK_DAYS}d")
        if hist.empty:
            return None
        series = hist["Close"].dropna()
        if len(series) < MIN_OBSERVATIONS:
            return None
        series.index = pd.DatetimeIndex(series.index).tz_localize(None)
        return series
    except Exception as exc:  # pragma: no cover - dépend du réseau
        log.warning("Echec récupération prix %s: %s", ticker, exc)
        return None


def _fit_best_arima(series: pd.Series):
    """Ajuste un ARIMA pour chaque ordre candidat et retourne celui qui
    minimise l'AIC (Akaike Information Criterion) — meilleur compromis
    qualité d'ajustement / complexité du modèle."""
    best_aic = np.inf
    best_fit = None
    best_order: tuple[int, int, int] | None = None

    for order in CANDIDATE_ORDERS:
        try:
            fit = ARIMA(series, order=order).fit()
            if fit.aic < best_aic:
                best_aic, best_fit, best_order = fit.aic, fit, order
        except Exception:
            continue  # certains ordres peuvent ne pas converger, on ignore

    return best_fit, best_order, best_aic


def _macro_bias_adjustment(
    forecast: np.ndarray, last_price: float, macro_score: float
) -> np.ndarray:
    """Overlay heuristique et transparent : quand le climat macro détecté
    par le pipeline de scoring des news est tendu (score > 5, seuil
    d'alerte par défaut), on amplifie légèrement la tendance déjà prédite
    par ARIMA (jamais on ne l'inverse). Le facteur est borné pour ne
    jamais dominer le signal statistique du modèle."""
    if macro_score <= 5.0:
        return forecast
    tension = min((macro_score - 5.0) / 10.0, 1.0)  # borné à [0, 1]
    drift = (forecast - last_price) * tension * 0.35
    return forecast + drift


def run_predictions(macro_score_24h: float = 5.0) -> dict:
    """Calcule les prévisions ARIMA pour tous les tickers suivis et écrit
    public/data/predictions.json. Retourne le payload généré."""
    results: dict[str, dict] = {}

    for label, ticker in TICKERS.items():
        series = _fetch_prices(ticker)
        if series is None:
            log.warning("Données insuffisantes pour %s, ignoré", label)
            continue

        fit, order, aic = _fit_best_arima(series)
        if fit is None:
            log.warning("Aucun ordre ARIMA n'a convergé pour %s, ignoré", label)
            continue

        forecast_res = fit.get_forecast(steps=HORIZON_DAYS)
        mean_forecast = forecast_res.predicted_mean.to_numpy()
        ci = forecast_res.conf_int(alpha=CI_ALPHA)
        lower = ci.iloc[:, 0].to_numpy()
        upper = ci.iloc[:, 1].to_numpy()

        last_price = round(float(series.iloc[-1]), 4)
        mean_forecast = _macro_bias_adjustment(mean_forecast, last_price, macro_score_24h)
        change_pct = (
            round(((mean_forecast[-1] - last_price) / last_price) * 100, 2)
            if last_price else 0.0
        )

        results[label] = {
            "ticker": ticker,
            "last_price": last_price,
            "forecast": [round(float(v), 4) for v in mean_forecast],
            "forecast_lower": [round(float(v), 4) for v in lower],
            "forecast_upper": [round(float(v), 4) for v in upper],
            "horizon_days": HORIZON_DAYS,
            "predicted_change_pct": change_pct,
            "model": {
                "type": "ARIMA",
                "order": list(order) if order else None,
                "aic": round(float(aic), 2) if np.isfinite(aic) else None,
                "confidence_level": f"{int((1 - CI_ALPHA) * 100)}%",
            },
        }

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "macro_score_24h": macro_score_24h,
        "predictions": results,
        "method": (
            "ARIMA(p,d,q) ajusté par maximum de vraisemblance, ordre "
            "sélectionné par AIC sur une grille restreinte, corrigé d'un "
            "biais macro post-hoc proportionnel au climat détecté par le "
            "pipeline de scoring des news."
        ),
        "disclaimer": (
            "Prevision indicative basee sur un modele ARIMA ajuste sur "
            "l'historique recent des prix. Ne constitue pas un conseil "
            "en investissement."
        ),
    }

    PREDICTIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PREDICTIONS_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log.info("Prédictions ARIMA écrites: %s (%d tickers)", PREDICTIONS_FILE, len(results))
    return payload
