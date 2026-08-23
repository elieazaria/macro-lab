"""
config.py
---------
Configuration centrale : sources RSS, fenêtre d'historique glissant,
chemins de fichiers.

Les flux RSS (et non l'API NYT, payante et à quota) sont utilisés pour
rester 100% gratuit. Ajoutez/retirez des flux librement — chaque source
doit juste exposer un flux RSS/Atom standard.
"""

from __future__ import annotations

from pathlib import Path

# Racine du dépôt (deux niveaux au-dessus de ce fichier : scraper/config.py)
ROOT_DIR = Path(__file__).resolve().parent.parent

# Historique interne (rolling 7 jours) — utilisé pour la normalisation
# dynamique du score, PAS servi directement par le site.
DATA_DIR = ROOT_DIR / "data"
HISTORY_DIR = DATA_DIR / "history"

# Snapshots publics — placés dans public/data/ pour que Vercel (qui sert
# le dossier "public" comme racine du site, voir vercel.json) les expose
# directement à /data/articles.json et /data/predictions.json.
PUBLIC_DATA_DIR = ROOT_DIR / "public" / "data"
ARTICLES_FILE = PUBLIC_DATA_DIR / "articles.json"
PREDICTIONS_FILE = PUBLIC_DATA_DIR / "predictions.json"

# Fenêtre glissante utilisée pour la normalisation dynamique du score
HISTORY_WINDOW_DAYS = 7

# Nombre max d'articles conservés par run (protège contre un flux qui
# renverrait un backlog énorme au premier passage)
MAX_ARTICLES_PER_FETCH = 60

# Sources RSS internationales (média, url du flux)
# NB: NYT propose des flux RSS publics et gratuits (nyt.com/rss) pour ses
# principales rubriques — pas besoin de clé API pour cette approche.
RSS_SOURCES: dict[str, str] = {
    "NYT World": "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "NYT Business": "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    "NYT Economy": "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml",
    "Reuters World": "https://www.reutersagency.com/feed/?best-topics=world&post_type=best",
    "Reuters Business": "https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best",
    "AP Top News": "https://rsshub.app/apnews/topics/apf-topnews",
}

# User-Agent poli pour le scraping du contenu complet des articles
USER_AGENT = (
    "MacroLabBot/1.0 (+https://github.com/your-username/macro-lab; "
    "research/education use, respects robots.txt)"
)
REQUEST_TIMEOUT = 15  # secondes

# Tickers suivis pour les prédictions de séries temporelles
TICKERS: dict[str, str] = {
    "Gold": "GC=F",
    "EUR/USD": "EURUSD=X",
    "Bitcoin": "BTC-USD",
    "S&P 500": "^GSPC",
    "CAC 40": "^FCHI",
}
