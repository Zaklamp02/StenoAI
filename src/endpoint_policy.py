"""Which remote endpoints may receive credentials or meeting content.

Plain HTTP is accepted only to this machine. A remote Ollama server, a custom
OpenAI-compatible endpoint and the organisation adapter all receive meeting
text, and the last two a credential as well; over HTTP anyone on the network
path reads both. A LAN address is not an encrypted transport. Reach a LAN
server through HTTPS (a reverse proxy) or an SSH tunnel to localhost.

URLs with credentials in them (user:pass@host) are refused too: they end up
in logs and are sent on every request.

Checked where a URL is saved and again where it is used, so a value written
by an older build or by hand cannot bypass the setter. The shell applies the
same rule to the adapter URL (app/endpoint-policy.js).
"""

import ipaddress
import urllib.parse
from typing import Optional


class InsecureEndpoint(ValueError):
    """The URL may not carry credentials or meeting content."""


def _is_loopback(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def require_secure_endpoint(url: str) -> str:
    """Return the URL (stripped, no trailing slash) or raise InsecureEndpoint.

    An empty value is allowed and means "not configured".
    """
    value = (url or "").strip()
    if not value:
        return ""
    try:
        parts = urllib.parse.urlsplit(value)
        port = parts.port  # raises on a malformed port
    except ValueError as error:
        raise InsecureEndpoint("That address is not a valid URL.") from error
    del port
    scheme = parts.scheme.lower()
    host = parts.hostname or ""
    if scheme not in ("http", "https") or not host:
        raise InsecureEndpoint("Use an https:// address.")
    if parts.username is not None or parts.password is not None:
        raise InsecureEndpoint("Remove the user name or password from the address.")
    if scheme == "http" and not _is_loopback(host):
        raise InsecureEndpoint(
            "Use https:// for a server on another machine. Plain http is only "
            "allowed for this Mac (localhost)."
        )
    return value.rstrip("/")


# --- Which destination a summarisation key belongs to (F04) -----------------
#
# A key is stored with the destination it was entered for (app/cloud-key-
# store.js) and handed to a job only together with that destination
# (STENOAI_CLOUD_KEY_DESTINATION). The job re-derives the destination from
# the config it is about to use and refuses the key on any difference, so
# neither a later endpoint change nor a change racing a running job can send
# the key somewhere it was not entered for. The format must match
# cloudKeyDestination in app/cloud-key-store.js exactly.

# Shown when a stored key was entered for another destination. Contains
# "is not configured" so the shell classifies it like a missing key
# (classifySummarizationStreamError: not_configured).
CLOUD_KEY_REENTER_MESSAGE = (
    "The cloud API key is not configured for this provider or address: it was "
    "entered for a different one. Enter it again in Settings > AI."
)

FIRST_PARTY_ORIGINS = {
    "openai": "https://api.openai.com",
    "anthropic": "https://api.anthropic.com",
}


def _origin(url: str) -> Optional[str]:
    """scheme://host[:port] the way a browser's URL.origin spells it, or
    None for anything else (non-ASCII hosts included, rather than guess at
    IDNA mapping)."""
    try:
        parts = urllib.parse.urlsplit(require_secure_endpoint(url))
        port = parts.port
    except ValueError:
        return None
    host = parts.hostname or ""
    if not host or not host.isascii():
        return None
    scheme = parts.scheme.lower()
    if ":" in host:
        host = f"[{host}]"
    default_port = {"http": 80, "https": 443}[scheme]
    return f"{scheme}://{host}" + (f":{port}" if port not in (None, default_port) else "")


def cloud_key_destination(provider: str, cloud_api_url: str, bedrock_region: str) -> Optional[str]:
    """The destination a cloud key would be sent to with this config, or
    None when there is no valid one (the key is then never used). Applies
    the same defaults as Config's getters (unknown provider -> openai, empty
    region -> us-east-1) so it agrees with the shell given raw config."""
    if provider not in ("openai", "anthropic", "bedrock", "custom"):
        provider = "openai"
    if provider == "bedrock" and not (isinstance(bedrock_region, str) and bedrock_region.strip()):
        bedrock_region = "us-east-1"
    elif isinstance(bedrock_region, str):
        bedrock_region = bedrock_region.strip()
    if provider in FIRST_PARTY_ORIGINS:
        return f"{provider}|{FIRST_PARTY_ORIGINS[provider]}"
    if provider == "bedrock":
        from src.config import BEDROCK_REGION_RE
        if not isinstance(bedrock_region, str) or not BEDROCK_REGION_RE.fullmatch(bedrock_region):
            return None
        return f"bedrock|https://bedrock-runtime.{bedrock_region}.amazonaws.com"
    if provider == "custom":
        origin = _origin(cloud_api_url or "")
        return f"custom|{origin}" if origin else None
    return None
