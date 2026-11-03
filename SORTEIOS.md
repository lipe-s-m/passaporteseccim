# Sorteios por dia

O sistema prepara as chances; não escolhe vencedores. Cada presença confirmada em uma atividade elegível gera **uma linha** em `public.raffle_entries`. Três palestras no mesmo dia = três chances. A mesma palestra não pode gerar duas chances para a mesma pessoa, mesmo que a organização repita a baixa.

O dia vem de `activities.event_date`, data real da palestra no calendário de São Paulo. `attendances.recorded_at` continua registrando quando a presença foi digitada e não define o sorteio. Uma presença de terça registrada na quarta participa de terça.

## Configuração inicial pela organização

No [SQL Editor do projeto](https://supabase.com/dashboard/project/mqparqbuhstkdpcgbbsa/sql/new), com a conta proprietária do banco:

1. Defina a data de cada palestra. As datas ficaram vazias porque o calendário não foi fornecido. Atividades sem data não geram chances até serem configuradas. Ao preencher a data, as presenças já registradas são incluídas automaticamente.
2. Escolha a conta que terá acesso administrativo. Cadastre-a normalmente no passaporte, confirme seu e-mail e entre uma vez. Não compartilhe a senha entre organizadores: cada responsável pode ter sua própria conta.
3. Conceda a permissão pelo UID verificado vinculado ao cadastro. A API e o usuário não conseguem conceder essa permissão.

Exemplos de SQL (substitua os valores pelos dados reais):

```sql
-- Conferir a programação antes de preencher datas.
select id, name, event_date, raffle_eligible from public.activities order by sort_order;

-- EXEMPLO de data: substituir pelo calendário oficial.
update public.activities set event_date = date '2026-11-03'
where id = 'mesa-redonda';

-- Uma atividade que não deva contar para brindes pode ser excluída do sorteio.
-- Isso não apaga o selo do passaporte.
-- update public.activities set raffle_eligible = false where id = 'ID_DA_ATIVIDADE';

-- Conferir o vínculo da conta desejada antes de autorizar.
select full_name, email, firebase_uid from public.participants
where email = 'EMAIL_DA_CONTA_ADMINISTRATIVA';

-- Substituir o e-mail; o comando só autoriza uma conta já vinculada.
insert into private.raffle_admins(firebase_uid,note)
select firebase_uid, 'Organização SECCIM'
from public.participants
where email = 'EMAIL_DA_CONTA_ADMINISTRATIVA' and firebase_uid is not null
on conflict(firebase_uid) do update set active = true;

-- Revogar pelo UID exato: passa a valer no próximo GET, mesmo com token válido.
-- update private.raffle_admins set active = false where firebase_uid = 'UID_DA_CONTA';
```

O campo `raffle_eligible` começa como `true` para os selos existentes. A organização pode excluir atividades que não façam parte dos brindes. As contas administrativas concedidas aqui podem **somente ler/exportar sorteios**: não recebem acesso para mudar presenças, datas ou outras contas pela API.

## Dar baixa nas presenças

Continue usando `public.attendances` no Supabase, com acesso da organização. Não edite `raffle_entries` manualmente. Os triggers executam na mesma transação da presença:

- Inserção de presença elegível com data → cria a chance.
- Repetição da baixa → não duplica a chance, por restrição única de participante e atividade.
- Exclusão/correção da presença → exclui/ajusta a chance correspondente.
- Correção da data → move as chances para o dia correto.
- Desativação da atividade ou retirada da elegibilidade → remove suas chances; reativação/configuração recompõe a partir das presenças.
- Nome corrigido do participante → o próximo GET devolve o nome atual.

As mudanças continuam refletindo no conjunto de chances. Exporte a lista definitiva após concluir/conferir as baixas e pause alterações durante a exportação e o sorteio. Este recurso não congela sorteios nem registra vencedores.

## GET administrativo

Endpoint já implantado:

```http
GET https://mqparqbuhstkdpcgbbsa.supabase.co/functions/v1/passport/admin/raffle?date=2026-11-03&offset=0
Authorization: Bearer TOKEN_ID_FIREBASE_DA_CONTA_ADMINISTRATIVA
```

Use o ID token obtido no login Firebase da própria conta. Não use uma senha na URL, nem chave `service_role` no navegador. A data é obrigatória (`AAAA-MM-DD`); a página contém no máximo 1.000 chances. Quando `hasMore` for `true`, repita com `offset=nextOffset`. A resposta inclui:

```json
{
  "date": "2026-11-03",
  "timezone": "America/Sao_Paulo",
  "offset": 0,
  "pageSize": 1000,
  "totalEntries": 4,
  "uniqueParticipants": 2,
  "hasMore": false,
  "nextOffset": null,
  "entries": [
    {"ticketId":"uuid-1","participantId":"pessoa-a","name":"Ana","activityId":"palestra-1","activityName":"Palestra 1"},
    {"ticketId":"uuid-2","participantId":"pessoa-a","name":"Ana","activityId":"palestra-2","activityName":"Palestra 2"},
    {"ticketId":"uuid-3","participantId":"pessoa-a","name":"Ana","activityId":"palestra-3","activityName":"Palestra 3"},
    {"ticketId":"uuid-4","participantId":"pessoa-b","name":"Bruno","activityId":"palestra-1","activityName":"Palestra 1"}
  ],
  "unconfiguredActivities": [],
  "pendingAttendances": 0
}
```

Exemplo ilustrativo de estrutura; os identificadores reais são UUIDs. `unconfiguredActivities` lista atividades elegíveis ativas sem data, e `pendingAttendances` conta presenças aguardando essa configuração em todo o evento. Esses registros não são atribuídos automaticamente ao dia da baixa.

Erros: `401` sem identidade válida; `403` com e-mail não confirmado ou sem permissão administrativa; `400` para data/paginação inválidas; `503` para indisponibilidade. As respostas não incluem e-mails, senhas nem credenciais e usam `Cache-Control: no-store`. Identificadores de participante e de chance aparecem somente nesta exportação administrativa para distinguir homônimos e chances individuais.

## Exportar sem programar uma interface

Na pasta do projeto, com Python instalado:

```powershell
python scripts/export_raffle.py 2026-11-03
```

O comando solicita o e-mail administrativo e a senha (oculta), autentica diretamente no Firebase e consulta todas as páginas. Senha e tokens não são gravados. São gerados:

- `dados-privados/sorteio-AAAA-MM-DD.json`: chances identificadas, nomes e totais.
- `dados-privados/sorteio-AAAA-MM-DD.txt`: um nome por linha, repetido conforme o número de chances.

O JSON mantém identificadores para diferenciar pessoas com o mesmo nome. O TXT serve a ferramentas que aceitem nomes repetidos como chances separadas; confirme que a ferramenta escolhida não elimina duplicatas. O exportador recusa dados com presenças sem data, detecta alterações nos totais/duplicação de tickets durante paginação e não escreve o arquivo nesse caso. Mantenha as baixas pausadas durante a operação; a API não oferece uma fotografia imutável entre vários GETs. Esses arquivos ficam ignorados pelo Git e excluídos do deploy Vercel.

## Arquitetura e validação

Migração: `20261103055811_daily_raffle.sql`. Tabelas: `public.raffle_entries` e `private.raffle_admins`, ambas com RLS. Usuários `anon` e `authenticated` não têm grants de leitura/escrita. O backend tem apenas SELECT nas duas tabelas, sem permissão para promover administradores ou inserir chances. Os triggers são `SECURITY INVOKER`, executados pelo papel administrativo que registra presenças no banco. O fluxo atual de baixa continua pelo SQL Editor/Table Editor como proprietário; não foi criada API de escrita de presenças.

A Edge Function valida o token e o estado atual da conta no Google, exige e-mail confirmado, e passa somente o UID confirmado à RPC `get_daily_raffle`. A RPC é `SECURITY INVOKER`, com `search_path` vazio e EXECUTE somente para `service_role`; consulta a tabela privada de permissões em cada chamada. Claims de papel, e-mail ou UID enviados pelo cliente não autorizam acesso.

Validações realizadas: 28 testes Node do frontend/backend; 3 testes Python do exportador (chances repetidas e homônimos, recusa de presenças sem data e alteração de contagem durante paginação); teste SQL transacional de proporção 3:1, separação por dia, baixa tardia, duplicidade, exclusão, reconfiguração, atividades inativas/inelegíveis, mais de 1.000 chances, permissões e revogação. Teste real com contas Firebase descartáveis confirmou `401` sem login, `403` para conta não confirmada/comum, `200` para conta autorizada e `403` imediato após revogação com o mesmo token. As contas e a autorização temporárias foram removidas. Nenhum vencedor foi sorteado.
