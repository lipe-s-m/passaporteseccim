"""Exporta chances do dia com login administrativo, sem salvar senha ou token.

Uso: python scripts/export_raffle.py 2026-11-03
Saída em dados-privados/: JSON completo e TXT com um nome por chance.
"""
import argparse
import datetime
import getpass
import json
import pathlib
import re
import urllib.error
import urllib.parse
import urllib.request


def request_json(url, *, body=None, token=None, public_key=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if public_key:
        headers["apikey"] = public_key
    request = urllib.request.Request(url, headers=headers,
                                     data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 403:
            raise RuntimeError("Conta sem permissão de sorteios ou e-mail não confirmado.") from None
        raise RuntimeError(f"A operação foi recusada (HTTP {error.code}). Confira a conta e tente novamente.") from None
    except urllib.error.URLError:
        raise RuntimeError("Não foi possível conectar. Confira a conexão e tente novamente.") from None


def export(date):
    root = pathlib.Path(__file__).resolve().parents[1]
    html = (root / "js" / "config.js").read_text(encoding="utf-8")
    config = {key: re.search(r'const ' + key + r' = "([^"]+)";', html).group(1)
              for key in ("FIREBASE_API_KEY", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY")}
    email = input("E-mail da conta administrativa: ").strip()
    password = getpass.getpass("Senha (não será exibida nem salva): ")
    session = request_json("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key="
                           + config["FIREBASE_API_KEY"],
                           body={"email": email, "password": password, "returnSecureToken": True})
    del password
    entries, offset, total, participants = [], 0, None, None
    while True:
        query = urllib.parse.urlencode({"date": date, "offset": offset})
        page = request_json(config["SUPABASE_URL"] + "/functions/v1/passport/admin/raffle?" + query,
                            token=session["idToken"], public_key=config["SUPABASE_PUBLISHABLE_KEY"])
        if page["pendingAttendances"]:
            raise RuntimeError("Há presenças sem data de palestra configurada. Configure as datas antes de exportar.")
        if page["unconfiguredActivities"]:
            print(f'Aviso: {len(page["unconfiguredActivities"])} atividade(s) ainda sem data; não geram chances.')
        if total is None:
            total, participants = page["totalEntries"], page["uniqueParticipants"]
        if total != page["totalEntries"] or participants != page["uniqueParticipants"]:
            raise RuntimeError("As presenças mudaram durante a exportação. Pause as baixas e tente novamente.")
        entries.extend(page["entries"])
        if not page["hasMore"]:
            break
        if page["nextOffset"] != offset + 1000:
            raise RuntimeError("Paginação inválida; nenhum arquivo foi exportado.")
        offset = page["nextOffset"]
    if len(entries) != total or len({e["ticketId"] for e in entries}) != total:
        raise RuntimeError("A lista mudou durante a exportação. Pause as baixas e tente novamente.")
    target = root / "dados-privados"
    target.mkdir(exist_ok=True)
    result = {"date": date, "timezone": "America/Sao_Paulo", "totalEntries": total,
              "uniqueParticipants": participants, "entries": entries}
    (target / f"sorteio-{date}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    # Nomes com quebras de linha continuam ocupando apenas uma chance na lista TXT.
    (target / f"sorteio-{date}.txt").write_text("".join(" ".join(e["name"].split()) + "\n" for e in entries), encoding="utf-8")
    print(f"Exportadas {total} chances de {participants} participantes para dados-privados/.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("date", help="Dia das palestras, no formato AAAA-MM-DD")
    args = parser.parse_args()
    try:
        if datetime.date.fromisoformat(args.date).isoformat() != args.date:
            raise ValueError()
        export(args.date)
    except (ValueError, RuntimeError, KeyError) as error:
        parser.exit(1, f"Falha: {error or 'data ou resposta inválida.'}\n")
