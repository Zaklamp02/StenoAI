"""urllib for requests that carry a credential.

urllib follows redirects by default and keeps every header, the
Authorization header included, whatever host the redirect points at. One
302 from an adapter (or anything able to answer in its place) then hands the
organisation session token or a provider key to another server. The
security review reproduced exactly that against the adapter calls (F05).

Authenticated calls here never follow a redirect. Our API endpoints answer
directly; a redirect from one is a misconfiguration or an attack, and the
fix for a legitimate move is to configure the final URL. The OpenAI and
Anthropic SDKs use httpx, which already drops Authorization on a
cross-origin redirect, so this covers the plain-urllib paths only.
"""

import urllib.error
import urllib.request


class RedirectRefused(urllib.error.HTTPError):
    """A credentialed request was answered with a redirect."""


class _RefuseRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # The target is deliberately left out of the message: it can carry
        # whatever the redirecting server put in it.
        raise RedirectRefused(
            req.full_url, code,
            f"Refused HTTP {code} redirect on an authenticated request",
            headers, fp,
        )


_OPENER = urllib.request.build_opener(_RefuseRedirects)


def open_authenticated(request: urllib.request.Request, timeout: float):
    """urlopen for a request carrying credentials: never follows redirects."""
    return _OPENER.open(request, timeout=timeout)
