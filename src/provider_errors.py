"""Error text that is safe to log, show and export.

A provider's exception message is the provider's text. OpenAI's and
Anthropic's include the response body, which can echo the prompt (meeting
content) or part of the key; a 4xx from an adapter or Bedrock can carry
anything. Those messages reach the debug console, processing.log, the
STREAM_ERROR line the renderer shows, and through all three the diagnostics
a user is invited to share. The security review reproduced a confidential
sentence travelling that whole way (F09).

So a third-party exception is reduced to its class and HTTP status at the
point it is caught. Our own exceptions keep their wording, which the shell
classifies (classifySummarizationStreamError in app/analytics-helpers.js),
after a scrub for anything shaped like a credential.
"""

import re

_MAX_CHARS = 300

# Exceptions whose message is ours (or the local Ollama server's, whose
# wording names models and memory, never meeting content) and is kept.
_OWN_MESSAGE_MODULES = ("builtins", "src.", "ollama")

_CREDENTIAL_PATTERNS = (
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+"), "Bearer [redacted]"),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{8,}"), "[redacted key]"),
    (re.compile(r"(?i)\b(api[_-]?key|token|password|secret)=([^&\s]+)"), r"\1=[redacted]"),
    (re.compile(r"(?i)(\b[a-z][a-z0-9+.-]*://)[^/\s:@]+(?::[^/\s@]*)?@"), r"\1[redacted]@"),
)


def _status(error) -> object:
    for attr in ("status_code", "code", "status"):
        value = getattr(error, attr, None)
        if isinstance(value, int):
            return value
    response = getattr(error, "response", None)
    value = getattr(response, "status_code", None)
    return value if isinstance(value, int) else None


def scrub_credentials(text: str) -> str:
    for pattern, replacement in _CREDENTIAL_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def safe_error_text(error: BaseException) -> str:
    """One line describing ``error`` without provider-supplied text."""
    name = type(error).__name__
    module = type(error).__module__ or ""
    if not module.startswith(_OWN_MESSAGE_MODULES):
        status = _status(error)
        return f"{name} (HTTP {status})" if status is not None else name
    text = " ".join(str(error).split())
    text = scrub_credentials(text)
    if len(text) > _MAX_CHARS:
        text = text[:_MAX_CHARS] + "…"
    return text or name
