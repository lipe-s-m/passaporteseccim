"""Verifica a API pública configurada em index.html, sem gravar dados ou autenticar pessoas."""
import json
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def main():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    url = re.search(r'const SUPABASE_URL = "([^"]+)";', html)
    key = re.search(r'const SUPABASE_PUBLISHABLE_KEY = "(sb_publishable_[^"]+)";', html)
    if not url or not key:
        print("Configure a URL e a chave publishable no index.html antes de verificar.", file=sys.stderr)
        return 1
    for table, columns, private in [
        ("activities", "id,name", False), ("site_content", "key,value", False),
        ("participants", "id", True), ("attendances", "activity_id", True)
    ]:
        request = Request(f"{url[1]}/rest/v1/{table}?select={columns}&limit=1000", headers={"apikey": key[1]})
        try:
            with urlopen(request, timeout=20) as response:
                rows = json.load(response)
            if private:
                raise ValueError(f"FALHA: {table} acessível sem autenticação.")
            if not isinstance(rows, list) or not rows:
                raise ValueError(f"FALHA: carga inicial ausente em {table}.")
            print(f"OK: {table} público, {len(rows)} registros retornados.")
        except HTTPError as error:
            if private and error.code in (401, 403):
                print(f"OK: {table} bloqueado para visitante (HTTP {error.code}).")
            else:
                raise ValueError(f"FALHA: HTTP {error.code} ao verificar {table}.") from None
    print("Verificação de leitura pública e bloqueio privado concluída. Login e entrega de e-mail exigem validação separada.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, URLError, TimeoutError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
