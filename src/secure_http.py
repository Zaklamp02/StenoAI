"""urllib for requests that carry a credential.

urllib follows redirects by default and keeps every header, the
Authorization header included, whatever host the redirect points at. One
302 from an adapter (or anything able to answer in its place) then hands the
organisation session token or a provider key to another server. The
security review reproduced exactly that against the adapter calls (F05).

Authenticated calls here never follow a redirect. Our API endpoints answer
directly; a redirect from one is a misconfiguration or an attack, and the
fix for a legitimate move is to configure the final URL.

The same goes for the SDK clients below. httpx drops Authorization on a
cross-origin redirect, but Anthropic authenticates with x-api-key, which it
keeps, and a 307/308 resends the body (the meeting text) to the new origin,
https to http included. The security recheck reproduced both (R1). The
OpenAI and Anthropic SDKs and the Ollama client all turn redirects on by
default, so every client that talks to a provider is built here with them
off: a redirect then fails as an HTTP 3xx error and nothing is resent.
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


def openai_client(api_key: str, base_url: str):
    """OpenAI SDK client that never follows a redirect."""
    from openai import DefaultHttpxClient, OpenAI
    return OpenAI(
        api_key=api_key, base_url=base_url,
        http_client=DefaultHttpxClient(follow_redirects=False),
    )


def anthropic_client(api_key: str, base_url: str):
    """Anthropic SDK client that never follows a redirect."""
    from anthropic import Anthropic, DefaultHttpxClient
    return Anthropic(
        api_key=api_key, base_url=base_url,
        http_client=DefaultHttpxClient(follow_redirects=False),
    )


def ollama_client(host=None, **kwargs):
    """Ollama client that never follows a redirect: a remote server receives
    meeting text, and a redirect could move it to plain http elsewhere."""
    import ollama
    return ollama.Client(host=host, follow_redirects=False, **kwargs)
