import unittest

from wechat_use import messages


class TestTableName(unittest.TestCase):
    def test_deterministic_md5(self):
        # standard md5("filehelper"). (Whether WeChat keys tables by md5(wxid) at
        # all is UNVERIFIED — this only locks that our helper is deterministic md5.)
        self.assertEqual(
            messages.msg_table_name("filehelper"),
            "Msg_9e20f478899dc29eb19741386f9343c8",
        )

    def test_group_wxid(self):
        name = messages.msg_table_name("20590343959@chatroom")
        self.assertTrue(name.startswith("Msg_"))
        self.assertEqual(len(name), len("Msg_") + 32)


class TestDecodeContent(unittest.TestCase):
    def test_plain_str(self):
        self.assertEqual(messages.decode_content("hello"), "hello")

    def test_plain_bytes(self):
        self.assertEqual(messages.decode_content("hi".encode()), "hi")

    def test_none(self):
        self.assertEqual(messages.decode_content(None), "")

    def test_group_prefix_stripped(self):
        self.assertEqual(messages.decode_content("wxid_abc123:\nhello group"), "hello group")

    def test_no_prefix_when_newline_in_head(self):
        # a colon deep in a multi-line body must NOT be treated as a sender prefix
        text = "line one\nkey: value"
        self.assertEqual(messages.decode_content(text), text)

    def test_hex_input(self):
        hexed = "hello".encode().hex()
        self.assertEqual(messages.decode_content(hexed, is_hex=True), "hello")

    def test_bad_hex_returns_raw(self):
        self.assertEqual(messages.decode_content("zzzz", is_hex=True), "zzzz")

    def test_zstd_roundtrip(self):
        try:
            import zstandard
        except ModuleNotFoundError:
            self.skipTest("zstandard not installed")
        blob = zstandard.ZstdCompressor().compress("压缩消息".encode())
        self.assertEqual(messages.decode_content(blob), "压缩消息")

    def test_zstd_via_hex(self):
        try:
            import zstandard
        except ModuleNotFoundError:
            self.skipTest("zstandard not installed")
        blob = zstandard.ZstdCompressor().compress("wxid_x:\n群里说话".encode())
        self.assertEqual(messages.decode_content(blob.hex(), is_hex=True), "群里说话")


if __name__ == "__main__":
    unittest.main()
