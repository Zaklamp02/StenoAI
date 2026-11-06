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

"Our own" is decided by who wrote the message, not by the exception's type
alone (security recheck R2): a class defined in this app, or a plain
ValueError/RuntimeError that our code raised. A ValueError raised inside a
library carries the library's text and is reduced like any other. The
Ollama server's error text is the server's, a remote one included, so only
the two shapes the shell classifies are kept, in fixed wording.
"""

import re
from typing import Optional

_MAX_CHARS = 300

# Modules whose code writes the messages we keep.
_OWN_MODULES = ("src.", "simple_recorder", "__main__")

# Built-in types our own code raises with its own wording. Exact types only:
# subclasses such as UnicodeDecodeError quote the data they failed on.
_OWN_BUILTIN_TYPES = (ValueError, RuntimeError, TimeoutError, ImportError, ModuleNotFoundError)

# The Ollama server errors the shell classifies, in fixed wording that still
# matches classifySummarizationStreamError. Anything else from the server is
# reduced to class and status.
_OLLAMA_SHAPES = (
    (re.compile(r"(?i)requires more system memory"),
     "Ollama: model requires more system memory than is available"),
    (re.compile(r"(?i)model .*not found|pull model manifest|file does not exist"),
     "Ollama could not find model"),
)

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


def _is_own(module: str) -> bool:
    return module.startswith(_OWN_MODULES)


def _raised_by_own_code(error: BaseException) -> bool:
    tb = error.__traceback__
    if tb is None:
        # Never raised: only code in this process constructed it.
        return True
    while tb.tb_next is not None:
        tb = tb.tb_next
    return _is_own(tb.tb_frame.f_globals.get("__name__") or "")


def _message_is_ours(error: BaseException) -> bool:
    cls = type(error)
    if _is_own(cls.__module__ or ""):
        return True
    return cls in _OWN_BUILTIN_TYPES and _raised_by_own_code(error)


def _ollama_server_text(error: BaseException) -> Optional[str]:
    try:
        from ollama import ResponseError
    except ImportError:
        return None
    if not isinstance(error, ResponseError):
        return None
    message = str(getattr(error, "error", ""))
    for pattern, fixed in _OLLAMA_SHAPES:
        if pattern.search(message):
            return fixed
    return None


def safe_error_text(error: BaseException) -> str:
    """One line describing ``error`` without provider-supplied text."""
    name = type(error).__name__
    if not _message_is_ours(error):
        status = _status(error)
        if isinstance(status, int) and status < 0:
            status = None  # ollama's "unknown"
        known = _ollama_server_text(error)
        if known:
            return f"{known} (HTTP {status})" if status is not None else known
        return f"{name} (HTTP {status})" if status is not None else name
    text = " ".join(str(error).split())
    text = scrub_credentials(text)
    if len(text) > _MAX_CHARS:
        text = text[:_MAX_CHARS] + "…"
    return text or name
