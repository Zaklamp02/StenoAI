import unittest

import httpx

from src.provider_errors import safe_error_text, scrub_credentials

SECRET = "CONFIDENTIAL_AUDIT_SENTENCE about the board's merger"
KEY = "sk-proj-AUDITFAKEKEY1234567890"


def _openai_error(status, cls_name):
    import openai
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    response = httpx.Response(
        status, request=request,
        json={"error": {"message": f"Prompt '{SECRET}' rejected. Incorrect API key provided: {KEY}"}},
    )
    return getattr(openai, cls_name)(f"Error code: {status} - {response.json()}", response=response, body=response.json())


class ProviderErrorTextTests(unittest.TestCase):
    """F09: what reaches logs, STREAM_ERROR and exported diagnostics."""

    def test_sdk_errors_keep_class_and_status_only(self):
        for status, name in ((401, "AuthenticationError"), (400, "BadRequestError"), (500, "InternalServerError")):
            with self.subTest(name=name):
                text = safe_error_text(_openai_error(status, name))
                self.assertEqual(text, f"{name} (HTTP {status})")
                self.assertNotIn("CONFIDENTIAL", text)
                self.assertNotIn("AUDITFAKE", text)

    def test_anthropic_errors_too(self):
        import anthropic
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        response = httpx.Response(400, request=request, json={"error": {"message": SECRET}})
        error = anthropic.BadRequestError(SECRET, response=response, body=response.json())
        self.assertEqual(safe_error_text(error), "BadRequestError (HTTP 400)")

    def test_connection_errors_keep_their_class_for_classification(self):
        error = httpx.ConnectError(f"[Errno 61] Connection refused while sending {SECRET}")
        self.assertEqual(safe_error_text(error), "ConnectError")

    def test_our_own_messages_keep_their_wording(self):
        # The shell classifies these by wording (classifySummarizationStreamError).
        error = RuntimeError("Org adapter rejected the request (401). Your session may have expired.")
        self.assertEqual(safe_error_text(error), str(error))

    def test_credentials_are_scrubbed_from_any_message(self):
        error = RuntimeError(
            f"failed with Authorization: Bearer eyJhbGciOi.payload.sig and key {KEY} "
            "at https://user:hunter2@api.example.test/v1?api_key=abc123"
        )
        text = safe_error_text(error)
        for leaked in ("eyJhbGciOi", "AUDITFAKE", "hunter2", "abc123"):
            self.assertNotIn(leaked, text)
        self.assertIn("Bearer [redacted]", text)

    def test_long_messages_are_bounded(self):
        self.assertLessEqual(len(safe_error_text(ValueError("x" * 5000))), 301)

    def test_scrub_leaves_ordinary_text(self):
        self.assertEqual(scrub_credentials("Model llama3 not found"), "Model llama3 not found")


class SummarizerErrorPathTests(unittest.TestCase):
    """The real error paths no longer carry provider text."""

    def test_bedrock_error_body_is_not_read_into_the_error(self):
        import io
        import urllib.error
        from unittest import mock
        from src.summarizer import OllamaSummarizer

        summarizer = OllamaSummarizer.__new__(OllamaSummarizer)
        summarizer.ollama_process = None
        summarizer.bedrock_api_key = "FAKE"
        summarizer.bedrock_region = "eu-west-1"
        summarizer.bedrock_inference_profile = ""
        summarizer.model_name = "model"
        error = urllib.error.HTTPError(
            "https://bedrock.example.test", 500, "err", {}, io.BytesIO(SECRET.encode()),
        )
        with mock.patch("src.summarizer.open_authenticated", side_effect=error), \
             mock.patch("src.summarizer.time.sleep"), \
             self.assertLogs("src.summarizer", level="ERROR") as logs:
            with self.assertRaises(RuntimeError) as raised:
                summarizer._bedrock_chat("prompt")
        self.assertEqual(str(raised.exception), "Bedrock HTTP 500")
        self.assertNotIn("CONFIDENTIAL", "\n".join(logs.output))


if __name__ == "__main__":
    unittest.main()
