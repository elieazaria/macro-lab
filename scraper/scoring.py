"""
scoring.py
----------
Calcule le score d'impact potentiel d'un article sur les marchés
financiers, puis normalise dynamiquement ce score par rapport à la
distribution des scores des 7 derniers jours (z-score glissant),
afin de faire ressortir les événements réellement atypiques plutôt
que de simples pics de volume.

score_brut(article)  -> somme pondérée des mots-clés / longueur du texte
score_normalise(art) -> (score_brut - moyenne_7j) / ecart_type_7j
                         puis remis à l'échelle sur [0, ~15] pour lisibilité

Le "seuil d'alerte" (SEUIL_ALERTE, ex. 5.0 dans le dashboard) s'applique
sur ce score normalisé.
"""

from __future__ import annotations

import re
import statistics as stats

from .lexicon import ALL_WEIGHTS, THEME_BONUS
from .themes import detect_themes

SEUIL_ALERTE = 5.0


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower())


def raw_score(title: str, full_text: str) -> float:
    """Score brut = somme des poids des mots-clés trouvés, pondérée par
    la longueur de l'article (pour ne pas favoriser les articles très longs),
    avec un bonus si le titre lui-même contient un mot-clé fort (les
    rédactions mettent les infos market-moving dans le titre)."""
    text = _normalize(full_text)
    title_norm = _normalize(title)

    n_words = max(len(text.split()), 1)
    total = 0.0
    for kw, weight in ALL_WEIGHTS.items():
        occurrences = text.count(kw)
        if occurrences:
            total += weight * min(occurrences, 5)  # cap pour éviter le spam
        if kw in title_norm:
            total += weight * 1.5  # bonus titre

    # Bonus thèmes critiques (guerre, sanctions, crash, etc.)
    themes = detect_themes(text)
    total += len(themes) * THEME_BONUS

    # Normalisation douce par la longueur (échelle log pour ne pas trop
    # pénaliser les articles courts type dépêche flash)
    length_factor = 1.0 + (n_words / 800.0)
    score = total / length_factor
    return round(score, 3)


def normalized_scores(articles: list[dict]) -> list[dict]:
    """Prend une liste d'articles (dict avec au moins 'raw_score' et
    'published_at') couvrant idéalement les 7 derniers jours, et ajoute
    un champ 'score' (z-score normalisé, remis à l'échelle) à chacun.

    Cette fonction doit être appelée sur l'historique glissant complet
    (7 jours), pas uniquement sur le batch du jour, afin que la moyenne
    et l'écart-type reflètent bien la "normalité" récente.
    """
    if not articles:
        return []

    raw_values = [a["raw_score"] for a in articles]
    mean = stats.fmean(raw_values)
    stdev = stats.pstdev(raw_values) or 1.0  # évite division par zéro

    for a in articles:
        z = (a["raw_score"] - mean) / stdev
        # Remise à l'échelle : centre autour de 5, borné à [0, 15] pour l'UI
        a["score"] = round(max(0.0, min(15.0, 5.0 + z * 2.5)), 2)
        a["is_alert"] = a["score"] >= SEUIL_ALERTE

    return articles
