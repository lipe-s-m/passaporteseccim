# Contexto para continuar o projeto

Atualizado em 3 de novembro de 2026, após o painel da organização. Leia este arquivo antes de continuar. Há documentação complementar em `DOCUMENTACAO.md` e `SORTEIOS.md`.

## Objetivo

Sortear brindes por dia entre quem assistiu às palestras. Cada presença confirmada pela organização gera uma chance para a pessoa no dia da palestra. Três palestras na terça dão três entradas no sorteio de terça; uma palestra dá uma. A organização precisa obter a lista com segurança; por enquanto, não é necessária uma interface.

## Arquitetura atual

- Frontend estático em `index.html`, publicado em https://passaporte-seccim.vercel.app.
- Firebase Authentication autentica por e-mail e senha. Supabase armazena participantes, atividades, presenças e perguntas, protegidos por RLS.
- A Edge Function Supabase `passport` valida tokens Firebase consultando o Google e interage com tabelas privadas pelo backend. A chave `service_role` nunca deve ir para o navegador.
- Projeto Supabase `mqparqbuhstkdpcgbbsa`, região São Paulo. Consulte `DOCUMENTACAO.md` para o histórico.
- Presenças: `public.attendances`, chave única `(participant_id, activity_id)`. Só a organização dá baixa.

## Recurso de sorteio já implementado

- Migração aplicada: `20261103055811_daily_raffle`, no arquivo `supabase/migrations/20261103055811_daily_raffle.sql`.
- Atividades têm `event_date` (dia real do evento no calendário de São Paulo) e `raffle_eligible`.
- `public.raffle_entries` contém uma chance por presença elegível, com chave única por pessoa/atividade. Triggers sincronizam presenças novas, correções, remoções, data, atividade ativa e elegibilidade.
- `private.admins` (antes `private.raffle_admins`) lista UIDs Firebase autorizados a registrar presenças e exportar sorteios. A concessão/revogação cabe ao proprietário do banco. A RPC consulta a permissão atual em cada GET.
- RPC `public.get_daily_raffle`; rota implantada na Edge Function `GET /functions/v1/passport/admin/raffle?date=AAAA-MM-DD&offset=0`. Exige token Firebase válido, e-mail confirmado e conta administrativa ativa. Claims de papel/UID enviados pelo cliente não autorizam acesso.
- Resposta paginada (até 1.000 entradas) contém nome, `participantId` e `ticketId` para distinguir homônimos, totais e atividades elegíveis sem data. Não contém e-mails.
- `scripts/export_raffle.py AAAA-MM-DD` pede e-mail e senha no terminal (oculta a senha), pagina o endpoint e grava JSON e TXT em `dados-privados/`. O TXT repete cada nome conforme suas chances. Senhas/tokens não são salvos. A pasta é ignorada pelo Git e excluída do deploy Vercel.
- Procedimentos e SQL ilustrativo em `SORTEIOS.md`.
- Teste de integração com contas Firebase temporárias comprovou: sem login 401; conta comum/não confirmada 403; admin temporário 200; revogação da permissão bloqueia imediatamente o mesmo token com 403. Contas e autorização temporárias foram removidas.
- Testes: `node --test tests/frontend.test.cjs tests/passport.test.mjs`; `python -m unittest discover -s tests -p test_export_raffle.py -v`; `supabase/tests/raffle.sql` (transação revertida). Confira o repositório para o estado atual antes de repetir qualquer alteração.

## Estado operacional (03/11/2026)

1. Conta administrativa da organização cadastrada, confirmada e autorizada em `private.admins`. O e-mail fica fora deste repositório público.
2. Datas oficiais aplicadas pela migração `20261103190000_event_dates.sql`, a partir do formulário de inscrição: 5 atividades em 03/11, 1 em 04/11, 4 em 05/11 e 5 em 06/11. Todas são elegíveis ao sorteio. "Meninas na Robótica" tem duas sessões no formulário, mas é um único selo.
3. Cadastro na hora e sorteio de ganhadores no painel (migração `20261103200000_walkin_and_draws.sql`). Pendente: a planilha real de inscrições não foi importada.

## Painel da organização (implantado)

- Migração `20261103180000_admin_attendance.sql` aplicada em produção com `supabase db push --remote`. Edge Function `passport` reimplantada com a rota `GET|POST|DELETE /passport/admin/attendance`. Site publicado na Vercel pela CLI, a partir da pasta vinculada (`.vercel/`, ignorada).
- Aba **Organização** no `index.html`: escolher a atividade, buscar por nome/e-mail, registrar/remover presença e baixar a lista do sorteio do dia. Detalhes em `DOCUMENTACAO.md` (seção "Painel da organização").
- Verificado em produção: rotas sem login respondem 401, método inválido 405, preflight 204; `check_api.py` OK; arquivos privados 404 na Vercel.
- A conta administrativa escolhida pela organização ainda precisa se cadastrar, confirmar o e-mail e entrar uma vez antes de receber a permissão. O e-mail não deve ser registrado neste repositório, que é público.
- A CLI do Supabase exige `--yes` para alterações em produção quando roda sem terminal; consultas usam `supabase db query --remote --read-only`.

## Regras importantes

- O dia da palestra vem de `activities.event_date`, não de `attendances.recorded_at`. Uma baixa tardia pertence ao dia da atividade.
- Repetir uma baixa não duplica chances. Correção ou exclusão da presença sincroniza sua chance.
- Atividades sem data não são atribuídas ao dia atual. Ao definir a data, as presenças já registradas são incluídas.
- Preserve RLS/grants restritivos. Não adicione acesso de participante ou `anon` ao sorteio. Nunca exponha `service_role` nem aceite UID/papel da query/body como autorização.
- Admin tem apenas leitura do sorteio. O proprietário do banco concede/revoga acesso; a verificação a cada requisição invalida a autorização imediatamente.
- Pause baixas durante exportações paginadas. A ferramenta detecta mudanças em totais/tickets duplicados, mas múltiplas solicitações GET não formam um snapshot transacional.
- Vencedores ficam em `public.raffle_draws`, com uma vitória por pessoa e dia.

## Arquivos principais

- `SORTEIOS.md`: operação, exemplo do endpoint, configuração e exportador.
- `DOCUMENTACAO.md`: arquitetura e histórico geral.
- `supabase/migrations/20261103055811_daily_raffle.sql`: banco e proteções.
- `supabase/functions/passport/handler.mjs`: autenticação e rota GET.
- `scripts/export_raffle.py`: exportação JSON/TXT.
- `supabase/tests/raffle.sql`, `tests/passport.test.mjs`, `tests/test_export_raffle.py`: verificações.

## Próxima ação

Quando o usuário enviar o e-mail administrativo e as datas, confira os valores no banco antes de alterar. Não reaplique a migração nem repita o deploy já concluídos. Teste acesso autorizado e negado e atualize a documentação.
