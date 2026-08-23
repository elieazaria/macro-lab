"""
lexicon.py
----------
Poids des mots-clés utilisés par le moteur de scoring (scoring.py) et
règles de détection de thèmes critiques (themes.py).

Chaque mot/expression est associé à un poids. Le score brut d'un article
est la somme des poids des occurrences trouvées dans le texte complet,
normalisée ensuite par la longueur de l'article puis par la distribution
glissante des 7 derniers jours (voir scoring.py).

Les poids sont volontairement simples (dictionnaire pondéré) pour rester
rapide et sans dépendance lourde (pas de modèle ML nécessaire pour tourner
gratuitement sur GitHub Actions). Le fichier est conçu pour être édité à
la main : ajoutez/retirez des entrées selon vos besoins.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Poids par catégorie. Poids plus élevé = impact potentiel plus fort.
# ---------------------------------------------------------------------------

FINANCE_WEIGHTS: dict[str, float] = {
    "recession": 8.0,
    "default": 9.0,
    "sovereign default": 10.0,
    "bankruptcy": 7.0,
    "bailout": 7.5,
    "bank run": 9.5,
    "banking crisis": 9.5,
    "credit crunch": 8.0,
    "liquidity crisis": 8.5,
    "market crash": 10.0,
    "sell-off": 6.5,
    "selloff": 6.5,
    "circuit breaker": 8.0,
    "volatility": 4.0,
    "vix": 5.0,
    "yield curve": 5.5,
    "inverted yield": 7.0,
    "credit downgrade": 7.5,
    "downgrade": 5.0,
    "default risk": 8.0,
    "junk bond": 5.0,
    "hedge fund collapse": 9.0,
    "margin call": 6.5,
    "short squeeze": 4.5,
    "ipo": 2.0,
    "earnings miss": 4.0,
    "profit warning": 5.0,
}

MONETARY_POLICY_WEIGHTS: dict[str, float] = {
    "federal reserve": 6.0,
    "fed": 5.0,
    "fomc": 6.5,
    "interest rate": 6.0,
    "rate hike": 7.5,
    "rate cut": 7.0,
    "emergency rate": 10.0,
    "emergency meeting": 9.0,
    "quantitative easing": 6.5,
    "quantitative tightening": 6.5,
    "central bank": 5.5,
    "ecb": 5.5,
    "european central bank": 5.5,
    "boj": 5.0,
    "bank of japan": 5.0,
    "bank of england": 5.0,
    "powell": 4.5,
    "lagarde": 4.0,
    "inflation": 6.0,
    "hyperinflation": 9.5,
    "cpi": 5.5,
    "stagflation": 8.0,
    "deflation": 6.5,
    "money supply": 4.0,
    "balance sheet": 3.5,
}

GEOPOLITICS_WEIGHTS: dict[str, float] = {
    "war": 8.0,
    "invasion": 9.5,
    "airstrike": 8.5,
    "missile strike": 8.5,
    "nuclear": 9.5,
    "ceasefire": 6.0,
    "sanctions": 7.5,
    "embargo": 7.0,
    "oil embargo": 9.0,
    "coup": 8.5,
    "martial law": 8.0,
    "conflict": 5.5,
    "military escalation": 8.0,
    "troops": 5.0,
    "border clash": 6.0,
    "geopolitical tension": 6.5,
    "opec": 5.5,
    "oil price": 5.0,
    "oil supply": 5.5,
    "pipeline attack": 8.0,
    "strait of hormuz": 9.0,
    "taiwan": 6.0,
    "trade war": 6.5,
    "tariff": 5.5,
    "export ban": 6.0,
    "energy crisis": 7.5,
}

MARKET_WEIGHTS: dict[str, float] = {
    "s&p 500": 5.0,
    "nasdaq": 4.5,
    "dow jones": 4.5,
    "stock market": 4.0,
    "wall street": 3.5,
    "treasury yields": 5.5,
    "bond market": 5.0,
    "dollar": 3.5,
    "euro": 3.0,
    "bitcoin": 3.5,
    "crypto crash": 7.0,
    "gold price": 4.0,
    "safe haven": 4.5,
    "flight to safety": 6.0,
    "investor panic": 7.5,
    "black swan": 8.5,
}

# Fusion de tous les dictionnaires pour un accès rapide dans scoring.py
ALL_WEIGHTS: dict[str, float] = {
    **FINANCE_WEIGHTS,
    **MONETARY_POLICY_WEIGHTS,
    **GEOPOLITICS_WEIGHTS,
    **MARKET_WEIGHTS,
}

# ---------------------------------------------------------------------------
# Thèmes critiques : chaque thème est détecté via une liste de mots-clés.
# L'ordre de THEMES définit la priorité d'affichage (couleur/icône côté UI).
# ---------------------------------------------------------------------------

THEMES: dict[str, list[str]] = {
    "War/Conflict": [
        "war", "invasion", "airstrike", "missile", "troops", "conflict",
        "military escalation", "border clash", "ceasefire",
    ],
    "Sanctions": [
        "sanctions", "embargo", "export ban", "asset freeze", "blacklist",
    ],
    "Market Crash": [
        "market crash", "sell-off", "selloff", "circuit breaker",
        "investor panic", "black swan", "crypto crash",
    ],
    "Fed Emergency": [
        "emergency rate", "emergency meeting", "fomc", "federal reserve",
        "rate hike", "rate cut",
    ],
    "Recession": [
        "recession", "stagflation", "gdp contraction", "unemployment surge",
    ],
    "Inflation": [
        "inflation", "hyperinflation", "cpi", "cost of living",
    ],
    "Banking Crisis": [
        "bank run", "banking crisis", "credit crunch", "liquidity crisis",
        "bailout",
    ],
    "Oil/Energy": [
        "opec", "oil price", "oil supply", "oil embargo", "energy crisis",
        "pipeline attack", "strait of hormuz",
    ],
    "Central Bank": [
        "central bank", "ecb", "boj", "bank of england", "powell",
        "lagarde", "quantitative easing", "quantitative tightening",
    ],
    "Volatility": [
        "volatility", "vix", "margin call", "short squeeze",
    ],
    "Default": [
        "default", "sovereign default", "bankruptcy", "credit downgrade",
        "downgrade",
    ],
    "Geo Shock": [
        "coup", "martial law", "nuclear", "taiwan", "geopolitical tension",
    ],
}

# Poids additionnel appliqué si un thème critique est détecté (bonus fixe),
# afin que les articles multi-thèmes ressortent davantage dans le score final.
THEME_BONUS = 3.0
