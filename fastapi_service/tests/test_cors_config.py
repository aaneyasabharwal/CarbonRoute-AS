"""M1.9: FastAPI CORS settings. Standard library only: python -m unittest discover -s fastapi_service/tests"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from cors_config import DEFAULT_ORIGINS, cors_settings  # noqa: E402


class CorsConfigTest(unittest.TestCase):
    def test_defaults_to_local_dev_origins_with_credentials(self):
        s = cors_settings({})
        self.assertEqual(s["allow_origins"], DEFAULT_ORIGINS)
        self.assertTrue(s["allow_credentials"])

    def test_reads_a_comma_separated_allow_list(self):
        s = cors_settings({"CORS_ORIGIN": "https://app.example.org, https://staging.example.org/"})
        self.assertEqual(s["allow_origins"], ["https://app.example.org", "https://staging.example.org"])
        self.assertTrue(s["allow_credentials"])

    def test_wildcard_never_allows_credentials(self):
        s = cors_settings({"CORS_ORIGIN": "*"})
        self.assertEqual(s["allow_origins"], ["*"])
        self.assertFalse(s["allow_credentials"])

    def test_methods_and_headers_are_explicit(self):
        s = cors_settings({})
        self.assertNotIn("*", s["allow_methods"])
        self.assertNotIn("*", s["allow_headers"])

    def test_main_uses_cors_settings_and_no_wildcard_with_credentials(self):
        with open(os.path.join(os.path.dirname(__file__), "..", "main.py"), encoding="utf-8") as f:
            src = f.read()
        self.assertIn("**cors_settings(os.environ)", src)
        self.assertNotIn('allow_origins=["*"]', src)


if __name__ == "__main__":
    unittest.main()
