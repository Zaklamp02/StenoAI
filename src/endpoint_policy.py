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
