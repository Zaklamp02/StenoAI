import http.server
import threading
import unittest
import urllib.request
import unittest.mock

from src.secure_http import RedirectRefused, open_authenticated


class _Recorder:
    def __init__(self):
        self.requests = []


def _serve(handler_factory):
    server = http.server.HTTPServer(("127.0.0.1", 0), handler_factory)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


class AuthenticatedRedirectTests(unittest.TestCase):
    """F05: a credentialed request must never carry its token to wherever a
    redirect points, on any redirect status, cross-origin or same-origin."""

    def setUp(self):
        self.collector = _Recorder()
        collector = self.collector

        class Collector(http.server.BaseHTTPRequestHandler):
            def _record(self):
                length = int(self.headers.get("content-length") or 0)
                collector.requests.append({
                    "path": self.path,
                    "authorization": self.headers.get("authorization"),
                    "body": self.rfile.read(length) if length else b"",
                })
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"{}")

            do_GET = do_POST = _record

            def log_message(self, *args):
                pass

        self.target = _serve(Collector)
        self.addCleanup(self.target.server_close)
        self.addCleanup(self.target.shutdown)

    def _redirector(self, status, location):
        class Redirect(http.server.BaseHTTPRequestHandler):
            def _redirect(self):
                length = int(self.headers.get("content-length") or 0)
                if length:
                    self.rfile.read(length)
                self.send_response(status)
                self.send_header("location", location)
                self.end_headers()

            do_GET = do_POST = _redirect

            def log_message(self, *args):
                pass

        server = _serve(Redirect)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_address[1]}/ai/chat"

    def _target_url(self):
        return f"http://127.0.0.1:{self.target.server_address[1]}/stolen"

    def test_no_redirect_status_carries_the_token_anywhere(self):
        for status in (301, 302, 303, 307, 308):
            with self.subTest(status=status):
                url = self._redirector(status, self._target_url())
                request = urllib.request.Request(
                    url, data=b'{"prompt": "MEETING-SECRET"}',
                    headers={"authorization": "Bearer FAKE-TOKEN"}, method="POST",
                )
                with self.assertRaises(RedirectRefused) as raised:
                    open_authenticated(request, timeout=5)
                self.assertEqual(raised.exception.code, status)
                self.assertNotIn("stolen", str(raised.exception))
        self.assertEqual(self.collector.requests, [])

    def test_a_same_origin_redirect_is_refused_too(self):
        port = self.target.server_address[1]
        url = self._redirector(302, f"http://127.0.0.1:{port}/same")
        request = urllib.request.Request(url, headers={"authorization": "Bearer FAKE-TOKEN"})
        with self.assertRaises(RedirectRefused):
            open_authenticated(request, timeout=5)
        self.assertEqual(self.collector.requests, [])

    def test_a_direct_answer_works(self):
        request = urllib.request.Request(
            self._target_url(), data=b"{}", headers={"authorization": "Bearer FAKE-TOKEN"}, method="POST",
        )
        with open_authenticated(request, timeout=5) as response:
            self.assertEqual(response.status, 200)
        self.assertEqual(self.collector.requests[0]["authorization"], "Bearer FAKE-TOKEN")


class AdapterRedirectTests(unittest.TestCase):
    """The real adapter calls go through the refusing opener."""

    def test_adapter_chat_and_stream_refuse_redirects(self):
        from src.summarizer import OllamaSummarizer
        summarizer = OllamaSummarizer.__new__(OllamaSummarizer)
        summarizer.adapter_url = "http://127.0.0.1:9"
        summarizer.adapter_token = "FAKE-TOKEN"

        def refuse(request, timeout):
            raise RedirectRefused(request.full_url, 302, "refused", {}, None)

        with unittest.mock.patch("src.summarizer.open_authenticated", side_effect=refuse) as opener, \
             unittest.mock.patch("src.summarizer.time.sleep"):
            with self.assertRaises(RedirectRefused):
                summarizer._adapter_chat("hello")
            self.assertEqual(opener.call_count, 1, "a refused redirect is not retried")
            with self.assertRaises(RedirectRefused):
                list(summarizer._adapter_stream("hello"))


if __name__ == "__main__":
    unittest.main()
