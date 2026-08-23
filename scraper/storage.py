"""
storage.py
----------
Gère l'historique glissant de 7 jours (léger : un fichier JSON par jour
dans data/history/, purge automatique des fichiers trop anciens) ainsi
que la génération du fichier data/articles.json consommé par le site
statique (public/index.html).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from .config import ARTICLES_FILE, HISTORY_DIR, HISTORY_WINDOW_DAYS, PUBLIC_DATA_DIR

log = logging.getLogger("storage")


def _day_file(date: datetime) -> "object":
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    return HISTORY_DIR / f"{date.strftime('%Y-%m-%d')}.json"


def load_existing_ids(days: int = HISTORY_WINDOW_DAYS) -> set[str]:
    """IDs déjà connus sur la fenêtre glissante, pour éviter les doublons."""
    ids: set[str] = set()
    for art in load_history(days):
        ids.add(art["id"])
    return ids


def append_today(new_articles: list[dict]) -> None:
    """Ajoute les nouveaux articles (déjà scorés) au fichier du jour."""
    today = datetime.now(timezone.utc)
    path = _day_file(today)
    existing: list[dict] = []
    if path.exists():
        existing = json.loads(path.read_text(encoding="utf-8"))

    existing_ids = {a["id"] for a in existing}
    for art in new_articles:
        if art["id"] not in existing_ids:
            existing.append(art)
            existing_ids.add(art["id"])

    path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Historique du jour mis à jour: %s (%d articles)", path.name, len(existing))


def load_history(days: int = HISTORY_WINDOW_DAYS) -> list[dict]:
    """Charge tous les articles des `days` derniers jours."""
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    articles: list[dict] = []

    for path in sorted(HISTORY_DIR.glob("*.json")):
        try:
            file_date = datetime.strptime(path.stem, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if file_date < cutoff - timedelta(days=1):
            continue
        articles.extend(json.loads(path.read_text(encoding="utf-8")))

    return articles


def purge_old_days(days: int = HISTORY_WINDOW_DAYS) -> None:
    """Supprime les fichiers d'historique plus vieux que la fenêtre glissante
    (garde le système léger, comme demandé dans le cahier des charges)."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    for path in HISTORY_DIR.glob("*.json"):
        try:
            file_date = datetime.strptime(path.stem, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if file_date < cutoff:
            path.unlink()
            log.info("Historique purgé: %s", path.name)


def write_site_snapshot(articles: list[dict], meta: dict) -> None:
    """Écrit public/data/articles.json : le fichier consommé par le
    dashboard statique (public/index.html), trié par score décroissant."""
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    sorted_articles = sorted(articles, key=lambda a: a.get("score", 0), reverse=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "meta": meta,
        "articles": sorted_articles,
    }
    ARTICLES_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log.info("Snapshot écrit: %s (%d articles)", ARTICLES_FILE, len(sorted_articles))
