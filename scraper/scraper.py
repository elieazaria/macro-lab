"""
scraper.py
----------
Récupère les derniers articles depuis les flux RSS configurés
(config.RSS_SOURCES), télécharge le contenu complet de chaque article,
puis renvoie une liste de dicts prêts à être scorés.

Dépendances : feedparser, trafilatura, requests (voir requirements.txt)
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone

import feedparser
import requests
import trafilatura

from .config import (
    MAX_ARTICLES_PER_FETCH,
    REQUEST_TIMEOUT,
    RSS_SOURCES,
    USER_AGENT,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("scraper")


def _article_id(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


def _parse_date(entry) -> str:
    """Retourne une date ISO8601 UTC, ou l'heure actuelle si absente."""
    for key in ("published_parsed", "updated_parsed"):
        val = getattr(entry, key, None)
        if val:
            return datetime(*val[:6], tzinfo=timezone.utc).isoformat()
    return datetime.now(timezone.utc).isoformat()


def fetch_full_text(url: str) -> str:
    """Télécharge et extrait le texte principal d'un article via
    trafilatura (gère le boilerplate, cookies banners, etc.)."""
    try:
        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            return ""
        text = trafilatura.extract(downloaded, include_comments=False) or ""
        return text
    except Exception as exc:  # pragma: no cover - réseau best-effort
        log.warning("Echec extraction contenu %s: %s", url, exc)
        return ""


def fetch_feed(source_name: str, feed_url: str) -> list[dict]:
    """Parse un flux RSS et renvoie une liste d'articles bruts (sans score)."""
    articles: list[dict] = []
    try:
        parsed = feedparser.parse(feed_url, agent=USER_AGENT)
    except Exception as exc:
        log.warning("Echec lecture flux %s (%s): %s", source_name, feed_url, exc)
        return articles

    for entry in parsed.entries[:MAX_ARTICLES_PER_FETCH]:
        url = getattr(entry, "link", None)
        title = getattr(entry, "title", "").strip()
        if not url or not title:
            continue

        summary = getattr(entry, "summary", "")
        full_text = fetch_full_text(url)
        body = full_text if len(full_text) > len(summary) else summary

        articles.append({
            "id": _article_id(url),
            "title": title,
            "url": url,
            "source": source_name,
            "published_at": _parse_date(entry),
            "summary": summary[:400],
            "full_text": body,
        })

    log.info("%s: %d articles récupérés", source_name, len(articles))
    return articles


def fetch_all() -> list[dict]:
    """Récupère les articles de toutes les sources configurées."""
    all_articles: list[dict] = []
    for name, url in RSS_SOURCES.items():
        all_articles.extend(fetch_feed(name, url))
    return all_articles
