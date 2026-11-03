import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("import_csv", ROOT / "scripts/import_csv.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ImportTests(unittest.TestCase):
    mapping = {"nome": "Nome", "email": "Email", "identificador": "ID", "selos": {"Mesa": "mesa"}}

    def test_validated_additive_import_and_sql_escaping(self):
        sql, participants, attendances = module.convert("Nome;Email;ID;Mesa\nD'Ávila;TESTE@EXAMPLE.COM;123;Sim\n", self.mapping, {"mesa"})
        self.assertEqual((participants, attendances), (1, 1))
        self.assertIn("D''Ávila", sql)
        self.assertIn("teste@example.com", sql)
        self.assertIn("on conflict", sql)
        self.assertNotIn("delete ", sql.lower())
        self.assertNotIn("auth_user_id", sql)

    def test_duplicates_fail_instead_of_merging_people(self):
        with self.assertRaises(ValueError):
            module.convert("Nome;Email;ID;Mesa\nA;a@example.com;1;Sim\nB;A@example.com;2;Não\n", self.mapping, {"mesa"})

    def test_unknown_presence_fails_instead_of_awarding_badge(self):
        with self.assertRaises(ValueError):
            module.convert("Nome;Email;ID;Mesa\nA;a@example.com;1;talvez\n", self.mapping, {"mesa"})

    def test_incomplete_activity_mapping_fails(self):
        with self.assertRaises(ValueError):
            module.convert("Nome;Email;ID;Mesa\nA;a@example.com;1;Sim\n", self.mapping, {"mesa", "outra"})

    def test_no_attendances_does_not_insert_badges(self):
        sql, _, count = module.convert("Nome;Email;ID;Mesa\nA;a@example.com;1;Não\n", self.mapping, {"mesa"})
        self.assertEqual(count, 0)
        self.assertNotIn("insert into public.attendances", sql)

    def test_sample_mapping_covers_fifteen_unique_ids(self):
        mapping = json.loads((ROOT / "supabase/import-mapping.example.json").read_text(encoding="utf-8"))
        self.assertEqual(len(set(mapping["selos"].values())), 15)


if __name__ == "__main__":
    unittest.main()
