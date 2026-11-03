"""Converte um CSV da planilha em SQL administrativo, sem acessar a rede.

Uso: python scripts/import_csv.py dados-privados/respostas.csv --mapping supabase/import-mapping.example.json
Revise o SQL gerado antes de executá-lo no SQL Editor do Supabase.
"""
import argparse
import csv
import io
import json
from pathlib import Path
import re
import sys
import unicodedata

ROOT = Path(__file__).resolve().parents[1]


def normalized(value):
    return "".join(c for c in unicodedata.normalize("NFKD", value.strip().casefold())
                   if not unicodedata.combining(c))


def sql_literal(value):
    # standard_conforming_strings é explicitamente habilitado no SQL gerado.
    return "'" + value.replace("'", "''") + "'"


def convert(source, mapping, valid_ids):
    reader = csv.DictReader(io.StringIO(source), dialect=csv.Sniffer().sniff(source[:8192], delimiters=",;\t"))
    columns = reader.fieldnames or []
    if len(columns) != len(set(columns)):
        raise ValueError("O CSV tem cabeçalhos duplicados.")
    required = [mapping["nome"], mapping["email"], *mapping["selos"].keys()]
    if mapping.get("identificador"):
        required.append(mapping["identificador"])
    missing = set(required) - set(columns)
    if missing:
        raise ValueError("Há colunas mapeadas ausentes no CSV. Confira os cabeçalhos e o mapeamento.")
    mapped_ids = list(mapping["selos"].values())
    if set(mapped_ids) != valid_ids or len(mapped_ids) != len(set(mapped_ids)):
        raise ValueError("Mapeie cada uma das 15 atividades do seed exatamente uma vez.")
    yes = {"1", "true", "sim", "s", "x", "presente", "confirmado", "conquistado", "✓", "✔"}
    no = {"", "0", "false", "nao", "n", "ausente", "pendente", "bloqueado"}
    participants, attendances, seen_emails, seen_ids = [], [], set(), set()
    for line, row in enumerate(reader, 2):
        if None in row or any(value is None for value in row.values()):
            raise ValueError(f"Linha {line}: quantidade de campos incorreta.")
        name, email = row[mapping["nome"]].strip(), row[mapping["email"]].strip().lower()
        legacy = row[mapping["identificador"]].strip() if mapping.get("identificador") else ""
        if not 1 <= len(name) <= 120 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 254:
            raise ValueError(f"Linha {line}: nome ou e-mail inválido.")
        if email in seen_emails or (legacy and legacy in seen_ids):
            raise ValueError(f"Linha {line}: cadastro duplicado. Resolva a duplicidade antes de importar.")
        seen_emails.add(email)
        if legacy:
            seen_ids.add(legacy)
        participants.append((name, email, legacy))
        for column, activity_id in mapping["selos"].items():
            value = normalized(row[column])
            if value not in yes | no:
                raise ValueError(f"Linha {line}: valor de presença desconhecido; confira o mapeamento e a legenda da planilha.")
            if value in yes:
                attendances.append((email, activity_id))
    if not participants:
        raise ValueError("O CSV não contém participantes.")
    values = ",\n".join(f"({sql_literal(n)}, {sql_literal(e)}, {sql_literal(i) if i else 'null'})" for n, e, i in participants)
    sql = """-- CONTÉM DADOS PESSOAIS. Não publicar ou versionar.
-- Importação aditiva: não apaga presenças existentes.
begin;
set local standard_conforming_strings = on;
insert into public.participants (full_name,email,legacy_id) values
""" + values + """
on conflict (email) do update set
  full_name = excluded.full_name,
  legacy_id = coalesce(excluded.legacy_id, public.participants.legacy_id);
"""
    if attendances:
        values = ",\n".join(f"({sql_literal(e)}, {sql_literal(a)})" for e, a in attendances)
        sql += """
insert into public.attendances (participant_id,activity_id)
select p.id, source.activity_id from (values
""" + values + """
) as source(email,activity_id)
join public.participants p on p.email = source.email
on conflict (participant_id,activity_id) do nothing;
"""
    sql += "commit;\n"
    return sql, len(participants), len(attendances)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--mapping", required=True, type=Path)
    args = parser.parse_args()
    try:
        seed = (ROOT / "supabase/seed.sql").read_text(encoding="utf-8").split("insert into public.site_content")[0]
        valid_ids = set(re.findall(r"^\('([a-z0-9-]+)',", seed, re.MULTILINE))
        mapping = json.loads(args.mapping.read_text(encoding="utf-8-sig"))
        sql, participants, attendances = convert(args.csv.read_text(encoding="utf-8-sig"), mapping, valid_ids)
        output = ROOT / "dados-privados/importacao.sql"
        output.parent.mkdir(exist_ok=True)
        output.write_text(sql, encoding="utf-8")
        print(f"SQL gerado em dados-privados/importacao.sql: {participants} participantes e {attendances} presenças. Revise antes de aplicar.")
    except (ValueError, KeyError, OSError, csv.Error):
        print("Falha na conversão. Confira arquivo, cabeçalhos, mapeamento completo, duplicidades e valores de presença. Nenhum SQL novo foi gravado; não reutilize um arquivo antigo.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
