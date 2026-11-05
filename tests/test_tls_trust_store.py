import unittest

import certifi

from src import tls_bootstrap


class TrustStoreTests(unittest.TestCase):
    """The bundled CA store every Python HTTPS call trusts (tls_bootstrap)."""

    def test_the_compromised_emsign_root_is_not_trusted(self):
        # GHSA-6q48-6c7w-9gw2: intermediates under this root had their keys
        # compromised. Fixed from certifi 2026.10.19.
        with open(certifi.where(), encoding="utf-8") as bundle:
            self.assertNotIn("emSign ECC Root CA - G3", bundle.read())

    def test_certifi_is_at_least_the_fixed_release(self):
        version = tuple(int(part) for part in certifi.__version__.split(".")[:3])
        self.assertGreaterEqual(version, (2026, 10, 19))

    def test_stdlib_ssl_is_pointed_at_that_bundle(self):
        import os
        tls_bootstrap.configure()
        self.assertEqual(os.environ.get("SSL_CERT_FILE"), certifi.where())
        self.assertEqual(os.environ.get("REQUESTS_CA_BUNDLE"), certifi.where())


if __name__ == "__main__":
    unittest.main()
