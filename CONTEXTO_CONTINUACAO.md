# Contexto para continuar a implementação dos sorteios

Atualizado em 3 de novembro de 2026. Leia este arquivo antes de continuar. Há documentação complementar em `DOCUMENTACAO.md` e `SORTEIOS.md`.

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
- `private.raffle_admins` lista UIDs Firebase autorizados. A concessão/revogação cabe ao proprietário do banco. A RPC consulta a permissão atual em cada GET.
- RPC `public.get_daily_raffle`; rota implantada na Edge Function `GET /functions/v1/passport/admin/raffle?date=AAAA-MM-DD&offset=0`. Exige token Firebase válido, e-mail confirmado e conta administrativa ativa. Claims de papel/UID enviados pelo cliente não autorizam acesso.
- Resposta paginada (até 1.000 entradas) contém nome, `participantId` e `ticketId` para distinguir homônimos, totais e atividades elegíveis sem data. Não contém e-mails.
- `scripts/export_raffle.py AAAA-MM-DD` pede e-mail e senha no terminal (oculta a senha), pagina o endpoint e grava JSON e TXT em `dados-privados/`. O TXT repete cada nome conforme suas chances. Senhas/tokens não são salvos. A pasta é ignorada pelo Git e excluída do deploy Vercel.
- Procedimentos e SQL ilustrativo em `SORTEIOS.md`.
- Teste de integração com contas Firebase temporárias comprovou: sem login 401; conta comum/não confirmada 403; admin temporário 200; revogação da permissão bloqueia imediatamente o mesmo token com 403. Contas e autorização temporárias foram removidas.
- Testes: `node --test tests/frontend.test.cjs tests/passport.test.mjs`; `python -m unittest discover -s tests -p test_export_raffle.py -v`; `supabase/tests/raffle.sql` (transação revertida). Confira o repositório para o estado atual antes de repetir qualquer alteração.

## O que falta para operar com dados reais

1. O usuário precisa informar o e-mail da conta administrativa. A pergunta foi enviada, mas a resposta ainda não chegou. Usar uma conta existente, cadastrada no passaporte e com e-mail confirmado. Não promover automaticamente a conta do usuário e nunca pedir senha no chat.
2. Consultar `public.participants` pelo e-mail informado e conferir o vínculo Firebase. Depois de confirmar o usuário-alvo com a organização, inserir somente o UID verificado em `private.raffle_admins` com a conta proprietária do Supabase. Confirmar GET 200 para essa conta e 403 para uma conta comum. A SQL ilustrativa e o procedimento estão em `SORTEIOS.md`. Não registrar UID/e-mail em documentação pública.
3. O usuário precisa informar as datas oficiais das 15 atividades. Última consulta ao banco: zero presenças reais, zero chances, 15 atividades ativas elegíveis sem data. Nenhuma data foi inventada. Atualizar `activities.event_date` conforme o calendário oficial; para atividade que não conta para brinde, configurar `raffle_eligible=false`. Conferir atividades sem data/totais depois.
4. Atualizar a documentação operacional após receber os dados. Entregar o comando de exportação. Arquivos de sorteio são privados; não publicar.

As ações 1 e 3 dependem de dados da organização que ainda não foram informados. Banco, função, exportador e testes estão implementados; não existe interface de sorteio nem escolha automática do vencedor.

## Regras importantes

- O dia da palestra vem de `activities.event_date`, não de `attendances.recorded_at`. Uma baixa tardia pertence ao dia da atividade.
- Repetir uma baixa não duplica chances. Correção ou exclusão da presença sincroniza sua chance.
- Atividades sem data não são atribuídas ao dia atual. Ao definir a data, as presenças já registradas são incluídas.
- Preserve RLS/grants restritivos. Não adicione acesso de participante ou `anon` ao sorteio. Nunca exponha `service_role` nem aceite UID/papel da query/body como autorização.
- Admin tem apenas leitura do sorteio. O proprietário do banco concede/revoga acesso; a verificação a cada requisição invalida a autorização imediatamente.
- Pause baixas durante exportações paginadas. A ferramenta detecta mudanças em totais/tickets duplicados, mas múltiplas solicitações GET não formam um snapshot transacional.
- Ainda não há função de escolha/armazenamento de vencedor.

## Arquivos principais

- `SORTEIOS.md`: operação, exemplo do endpoint, configuração e exportador.
- `DOCUMENTACAO.md`: arquitetura e histórico geral.
- `supabase/migrations/20261103055811_daily_raffle.sql`: banco e proteções.
- `supabase/functions/passport/handler.mjs`: autenticação e rota GET.
- `scripts/export_raffle.py`: exportação JSON/TXT.
- `supabase/tests/raffle.sql`, `tests/passport.test.mjs`, `tests/test_export_raffle.py`: verificações.

## Próxima ação

Quando o usuário enviar o e-mail administrativo e as datas, confira os valores no banco antes de alterar. Não reaplique a migração nem repita o deploy já concluídos. Teste acesso autorizado e negado e atualize a documentação.
