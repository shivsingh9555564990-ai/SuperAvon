"""Configuration management."""
import json
import os

def sanitize_proxy(raw_proxy: str) -> str:
    """Sanitize proxy string, returning None if malformed or containing curl syntax."""
    if not raw_proxy or not isinstance(raw_proxy, str):
        return None
    cleaned = raw_proxy.strip().strip("'\"")
    if cleaned.startswith("curl") or " " in cleaned or "http" not in cleaned.lower():
        return None
    return cleaned


DEFAULT_CONFIG = {
    "port": 8081,
    "host": "0.0.0.0",
    "retry_attempts": 3,
    "retry_delay_sec": 2,
    "request_timeout_sec": 180,
    "gemini_bl": "boq_assistant-bard-web-server_20260716.08_p0",
    "auth_user": None,
    "xsrf_token": None,
    "default_model": "gemini-3.6-flash",
    "log_requests": True,
    "cookie_file": None,
    "proxy": sanitize_proxy(os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")),
    "relay_url": os.environ.get("CLOUDFLARE_WORKER_URL") or os.environ.get("CF_RELAY_URL") or None,
    "api_keys": [],
    "temporary_chats": False,
}

CONFIG = dict(DEFAULT_CONFIG)


def load_config(path: str = None):
    """Load config from JSON file."""
    if path and os.path.exists(path):
        with open(path) as f:
            CONFIG.update(json.load(f))
    if not CONFIG.get("relay_url"):
        CONFIG["relay_url"] = os.environ.get("CLOUDFLARE_WORKER_URL") or os.environ.get("CF_RELAY_URL") or None
    return CONFIG


def find_config():
    """Search for config file in standard locations."""
    for p in ["./config.json", os.path.expanduser("~/.config/gemini-web2api/config.json")]:
        if os.path.exists(p):
            return p
    return None
