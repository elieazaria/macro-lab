"""
themes.py
---------
Détection de thèmes critiques (guerre, sanctions, crise financière,
décisions monétaires, ...) à partir du texte d'un article.

Approche volontairement simple (recherche de mots-clés, insensible à la
casse) pour rester rapide et gratuite à exécuter toutes les heures sur
GitHub Actions, sans dépendance à une API de NLP payante.
"""

from __future__ import annotations

import re

from .lexicon import THEMES


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower())


def detect_themes(text: str) -> list[str]:
    """Retourne la liste des thèmes critiques détectés dans `text`."""
    norm = _normalize(text)
    found: list[str] = []
    for theme, keywords in THEMES.items():
        for kw in keywords:
            if kw in norm:
                found.append(theme)
                break
    return found


def theme_counts(articles: list[dict]) -> dict[str, int]:
    """Compte le nombre d'articles par thème (pour le donut chart)."""
    counts: dict[str, int] = {t: 0 for t in THEMES}
    for art in articles:
        for t in art.get("themes", []):
            counts[t] = counts.get(t, 0) + 1
    # Ne garder que les thèmes présents, triés par fréquence décroissante
    return dict(sorted(
        ((k, v) for k, v in counts.items() if v > 0),
        key=lambda kv: kv[1],
        reverse=True,
    ))
