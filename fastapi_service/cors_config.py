"""
CORS settings for the FastAPI service (M1.9).

Browsers reject `Access-Control-Allow-Origin: *` together with credentials, and allowing any
origin with credentials would let any website act for a signed-in user. Allowed origins
therefore come from an explicit list: CORS_ORIGIN (comma-separated, as for the Node backend).
Credentials are only allowed for an explicit list, never for "*".
"""

from typing import Dict, List, Mapping

DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173"]


def allowed_origins(env: Mapping[str, str]) -> List[str]:
    raw = env.get("CORS_ORIGIN", "") or ""
    origins = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
    return origins or list(DEFAULT_ORIGINS)


def cors_settings(env: Mapping[str, str]) -> Dict[str, object]:
    origins = allowed_origins(env)
    wildcard = "*" in origins
    return {
        "allow_origins": ["*"] if wildcard else origins,
        # Credentials are never combined with a wildcard origin.
        "allow_credentials": not wildcard,
        "allow_methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Authorization", "Content-Type"],
    }
