"""
run.py
------
Point d'entrée du pipeline horaire :

  1. Scrape les flux RSS internationaux configurés
  2. Filtre les articles déjà connus (dédoublonnage sur 7 jours)
  3. Calcule le score brut + détecte les thèmes critiques
  4. Recharge l'historique glissant de 7 jours et recalcule la
     normalisation dynamique (z-score) sur l'ensemble
  5. Sauvegarde l'historique du jour + purge les jours > 7
  6. Génère data/articles.json (consommé par le site statique)
  7. Lance les prédictions de séries temporelles (or, EUR/USD, BTC, indices)

Utilisation :
    python -m scraper.run
"""

from __future__ import annotations

import logging

from . import storage
from .history import run_history_fetch
from .predict import run_predictions
from .scoring import SEUIL_ALERTE, normalized_scores, raw_score
from .scraper import fetch_all
from .themes import detect_themes, theme_counts

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("run")


def main() -> None:
    log.info("=== Macro Lab — pipeline horaire ===")

    known_ids = storage.load_existing_ids()
    fetched = fetch_all()
    new_articles = [a for a in fetched if a["id"] not in known_ids]
    log.info("%d articles récupérés, %d nouveaux", len(fetched), len(new_articles))

    for art in new_articles:
        text_for_scoring = f"{art['title']} {art['full_text'] or art['summary']}"
        art["raw_score"] = raw_score(art["title"], text_for_scoring)
        art["themes"] = detect_themes(text_for_scoring)
        # On ne garde pas le texte complet dans l'historique (léger + évite
        # tout souci de republication de contenu protégé) : uniquement le
        # résumé pour l'affichage.
        art.pop("full_text", None)

    if new_articles:
        storage.append_today(new_articles)

    storage.purge_old_days()

    # Recharge la fenêtre glissante complète pour une normalisation dynamique
    # cohérente (et pas seulement sur le batch du jour)
    window = storage.load_history()
    window = normalized_scores(window)

    alerts = [a for a in window if a.get("is_alert")]
    scores = [a["score"] for a in window] or [0]
    meta = {
        "total_articles_7j": len(window),
        "articles_today": len(new_articles),
        "alerts_critiques": len(alerts),
        "score_moyen": round(sum(scores) / len(scores), 2),
        "seuil_alerte": SEUIL_ALERTE,
        "themes": theme_counts(window),
    }

    storage.write_site_snapshot(window, meta)

    # Score macro moyen des dernières 24h : on relie les nouveaux articles
    # (qui n'ont pas encore de score normalisé) à leur version scorée dans
    # `window` via leur id, puis on moyenne.
    new_ids = {a["id"] for a in new_articles}
    today_scores = [a["score"] for a in window if a["id"] in new_ids]
    macro_24h = round(sum(today_scores) / len(today_scores), 2) if today_scores else meta["score_moyen"]

    try:
        run_predictions(macro_score_24h=macro_24h or meta["score_moyen"])
    except Exception:  # best-effort : ne bloque pas le pipeline news
        # log.exception affiche la trace complète dans les logs GitHub Actions
        # (indispensable pour diagnostiquer un échec yfinance/ARIMA silencieux)
        log.exception("Prédictions ignorées suite à une erreur")

    try:
        run_history_fetch()
    except Exception:
        log.exception("Récupération de l'historique des prix ignorée suite à une erreur")

    log.info("=== Pipeline terminé : %d alertes critiques / %d articles (7j) ===",
              len(alerts), len(window))


if __name__ == "__main__":
    main()
