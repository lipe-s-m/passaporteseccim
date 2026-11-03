import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

SOURCE = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "export_raffle.py"
spec = importlib.util.spec_from_file_location("export_raffle", SOURCE)
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class RaffleExportTests(unittest.TestCase):
    def fixture(self, root):
        (root / "index.html").write_text('\n'.join(
            f'const {key} = "{value}";' for key, value in (
                ("FIREBASE_API_KEY", "public-test"), ("SUPABASE_URL", "https://test.invalid"),
                ("SUPABASE_PUBLISHABLE_KEY", "public-key"))), encoding="utf-8")

    def run_export(self, root, pages):
        with patch.object(exporter, "__file__", str(root / "scripts" / "export_raffle.py")), \
             patch("builtins.input", return_value="admin@example.invalid"), \
             patch.object(exporter.getpass, "getpass", return_value="memory-only"), \
             patch.object(exporter, "request_json", side_effect=[{"idToken": "memory-only"}, *pages]), \
             patch("builtins.print"):
            exporter.export("2026-11-03")

    def test_preserves_one_line_per_ticket_and_identifies_homonyms(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            self.fixture(root)
            entries = [{"ticketId": str(i), "participantId": "a" if i < 3 else "b", "name": "Ana\nSilva"}
                       for i in range(4)]
            page = {"entries": entries, "totalEntries": 4, "uniqueParticipants": 2,
                    "hasMore": False, "pendingAttendances": 0, "unconfiguredActivities": []}
            self.run_export(root, [page])
            content = json.loads((root / "dados-privados/sorteio-2026-11-03.json").read_text(encoding="utf-8"))
            self.assertEqual(content["entries"], entries)
            self.assertEqual((root / "dados-privados/sorteio-2026-11-03.txt").read_text(encoding="utf-8").splitlines(),
                             ["Ana Silva"] * 4)

    def test_refuses_pending_attendances_without_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            self.fixture(root)
            with self.assertRaisesRegex(RuntimeError, "sem data"):
                self.run_export(root, [{"pendingAttendances": 1}])
            self.assertFalse((root / "dados-privados").exists())

    def test_refuses_changed_counts_during_pagination(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            self.fixture(root)
            page = {"entries": [], "totalEntries": 1001, "uniqueParticipants": 2,
                    "hasMore": True, "nextOffset": 1000, "pendingAttendances": 0, "unconfiguredActivities": []}
            with self.assertRaisesRegex(RuntimeError, "mudaram"):
                self.run_export(root, [page, {**page, "totalEntries": 1002}])
            self.assertFalse((root / "dados-privados").exists())


if __name__ == "__main__":
    unittest.main()
