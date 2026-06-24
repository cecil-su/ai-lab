import json
import unittest

from wechat_use import export


class TestExport(unittest.TestCase):
    def test_json_roundtrip(self):
        rows = [{"display_text": "hi", "create_time": 1}]
        self.assertEqual(json.loads(export.to_json(rows)), rows)

    def test_markdown_full_row(self):
        rows = [{"create_time": 100, "sender_name": "张三", "display_text": "你好"}]
        md = export.to_markdown(rows)
        self.assertIn("- [100] **张三**: 你好", md)

    def test_markdown_text_only(self):
        rows = [{"display_text": "solo"}]
        self.assertIn("- solo", export.to_markdown(rows))

    def test_markdown_fallback_unknown_schema(self):
        rows = [{"weird_col": "x", "another": 2}]
        md = export.to_markdown(rows)
        self.assertIn("weird_col", md)  # data not lost

    def test_title(self):
        self.assertTrue(export.to_markdown([], title="群A").startswith("# 群A"))


if __name__ == "__main__":
    unittest.main()
