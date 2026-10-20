"""Verify news settings writes without loading the crawler or real settings."""
import ast
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[2] / 'routers' / 'admin_news.py'
tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
selected = ast.Module(body=[node for node in tree.body if (
    isinstance(node, ast.ImportFrom) and node.module == 'datetime'
) or getattr(node, 'name', None) in ('_read_settings_payload', '_write_interval')], type_ignores=[])

class NewsSettingsTests(unittest.TestCase):
    def write(self, settings, seconds):
        namespace = {'json': json, 'SETTINGS_FILE': settings}
        exec(compile(selected, str(SOURCE), 'exec'), namespace)
        namespace['_write_interval'](seconds)
        return json.loads(settings.read_text(encoding='utf-8'))

    def test_creates_settings_and_valid_timestamp(self):
        from datetime import datetime
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder:
            settings = Path(folder) / 'config' / 'settings.json'
            result = self.write(settings, 1800)
            self.assertEqual(result['interval_seconds'], 1800)
            datetime.strptime(result['updated_at'], '%Y-%m-%d %H:%M:%S')
            self.assertFalse(settings.with_suffix('.tmp').exists())

    def test_preserves_other_integrated_settings(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder:
            settings = Path(folder) / 'settings.json'
            original = {'interval_seconds': 3600, 'baseball_schedules': [{'season': 2025}], 'label': '자동 수집'}
            settings.write_text(json.dumps(original), encoding='utf-8')
            result = self.write(settings, 600)
            self.assertEqual(result['interval_seconds'], 600)
            self.assertEqual(result['baseball_schedules'], original['baseball_schedules'])
            self.assertEqual(result['label'], original['label'])

if __name__ == '__main__':
    unittest.main()
