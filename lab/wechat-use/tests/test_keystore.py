import tempfile
import unittest
from pathlib import Path

from wechat_use import keystore


class TestKeystore(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._dir = keystore.KEY_DIR
        self._file = keystore.KEY_FILE
        keystore.KEY_DIR = Path(self._tmp.name) / ".wx-rs"
        keystore.KEY_FILE = keystore.KEY_DIR / "keys.json"

    def tearDown(self):
        keystore.KEY_DIR = self._dir
        keystore.KEY_FILE = self._file
        self._tmp.cleanup()

    def test_round_trip(self):
        k = "ab" * 32
        keystore.set_key(k)
        self.assertEqual(keystore.get_key(), k)

    def test_normalizes_prefix_and_case(self):
        keystore.set_key("0X" + "AB" * 32)
        self.assertEqual(keystore.get_key(), "ab" * 32)

    def test_rejects_short(self):
        with self.assertRaises(ValueError):
            keystore.set_key("123")

    def test_rejects_non_hex(self):
        with self.assertRaises(ValueError):
            keystore.set_key("zz" * 32)

    def test_accounts_isolated(self):
        keystore.set_key("aa" * 32, "default")
        keystore.set_key("bb" * 32, "work")
        self.assertEqual(keystore.get_key("default"), "aa" * 32)
        self.assertEqual(keystore.get_key("work"), "bb" * 32)

    def test_missing_account(self):
        self.assertIsNone(keystore.get_key("nope"))


if __name__ == "__main__":
    unittest.main()
