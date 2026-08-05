# Runbook — sobreviver ao ciclo de egress (04–07/08/2026)

Escrito em 05/08/2026, madrugada, com o ciclo do Supabase em 4,34 GB de 5 GB e
dois dias de ETHB SP pela frente (`ethb-sp-d2`, `ethb-sp-d3`).

## O que aconteceu

No dia 04/08 o egress bateu 668 MB — o pico histórico, 97,8% dele em PostgREST
(`/rest/v1/`). Não foi "o sistema todo": foi **uma query só**. A lista de
participantes (366 linhas × 26 campos) era rebaixada inteira a cada 5 segundos
por aparelho com a tela acesa.

Com gzip (o `supabase-js` já pede compressão, verificado), cada lista custa
~40 kB de egress. 668 MB ÷ 40 kB ≈ **17.000 downloads da lista em um dia** —
o que equivale a ~3 celulares × 8 horas de balcão. Bate com a operação real.

A causa raiz era uma linha em `db.js`:

```js
data.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), null)
```

Em JS, `'2026-...' > null` é `false` (o `null` vira 0 e a string vira `NaN`),
então o acumulador nunca saía de `null`. Com `updatedAt` sempre nulo, o cliente
nunca mandava `since` e o delta-polling — que já estava escrito e parecia
correto — **nunca era executado**. O sintoma, no log de API do Supabase, era a
ausência total de requisições `select=updated_at`.

## O que está no ar (commits `76fefad` e `3a05990`)

| Camada | Efeito |
|---|---|
| `reduce` corrigido | destrava o `unchanged`: poll sem novidade custa **62 bytes** em vez de 398 kB |
| `alteradosDesde` | quando algo muda, manda só as linhas tocadas — não a lista toda |
| merge com trava | se a contagem após o merge não bate com a do servidor, refaz o full |
| `useOcioso` (10 min) | tela acesa e parada não consulta nada; volta no primeiro toque |
| sessão de 12h | token passa a expirar (antes **nunca** expirava) |
| failsafe do delta | qualquer erro no caminho otimizado cai no full em vez de dar 500 |
| reconciliação de 10 min | refaz a lista inteira periodicamente; divergência morre em minutos |

Validado em produção: `unchanged` responde 62 bytes, `since` inválido responde
200 (cai no full), sessão carimba `exp` de 12h, bundle novo servido.

## AMANHÃ, ANTES DE ABRIR O BALCÃO

1. **Todos os operadores vão precisar logar de novo, e o login tem que ser DE
   MANHÃ — não na noite anterior.** A sessão expira 12h após o login. Quem logar
   às 19h da véspera para "deixar pronto" vai ter a sessão vencendo às 7h, no
   meio do balcão. Logando às 7h, ela cobre até as 19h. A senha é a mesma de
   sempre; avise a equipe para o pedido de login não parecer que "quebrou".
2. Abra o app em **um** aparelho e credencie uma pessoa de teste. A lista tem
   que atualizar nos outros aparelhos em até 5 segundos. Se atualizar, o delta
   está funcionando.
3. Se a tela ficar 10 min parada ela **para de atualizar de propósito**. Isso é
   a economia funcionando. Um toque na tela religa e sincroniza na hora.

## Sinais de que algo deu errado

| Sintoma | Provável causa | O que fazer |
|---|---|---|
| Lista não atualiza nem ao tocar | delta caiu num loop de full | trocar `POLL_MS` para 15000 em `src/App.jsx`, rebuildar, push |
| Pessoa credenciada aparece como pendente em OUTRO aparelho | colisão de milissegundo entre dois celulares (documentada abaixo) | espera até 10 min e se corrige sozinha; se tiver pressa, recarregue a página |
| Pessoa credenciada some da lista | merge perdeu linha (a trava deveria impedir) | recarregar a página força o full; reportar |
| Erro 401 no meio do expediente | sessão de 12h venceu | logar de novo, é esperado |
| Egress voltando a subir rápido | algum aparelho com bundle antigo em cache | forçar recarga (puxar para baixo no PWA) |

## Rollback de emergência

O código anterior está em `85b45ab`. Para voltar tudo:

```bash
git revert --no-edit 3a05990 76fefad
git push origin master
```

A Hostinger deploya sozinha em ~50 s (`source_type: git`, entry `server.js`).
Confira em Deployments que o estado ficou `completed`.

**Atenção:** reverter traz de volta o consumo de ~670 MB/dia. Só faça isso se o
credenciamento estiver realmente quebrado — se for só lentidão, prefira subir o
`POLL_MS`.

## QR Codes — auditados, estão redondos

Verificado no banco e contra produção:

| Verificação | Resultado |
|---|---|
| Tokens nulos (pessoa sem QR) | **0** nos três dias |
| Tokens duplicados dentro do dia | **0** nos três dias |
| Consistência d2 → d3 | **perfeita**, 0 diferenças |
| Pessoa do d2 escaneia no d2 | resolve certo |
| Página pública `/qr` e `/qrimg` | 200 + PNG |
| QR de outro sistema / ilegível | 404 tratado, sem travar |

O token deriva do **grupo** (`ethb-sp`), não do dia — então o mesmo QR impresso
vale para d1, d2 e d3. A resolução é feita dentro do dia aberto, e o app abre
sozinho no evento cuja data é a de hoje.

### ⚠️ 4 pessoas do Dia 1 não existem na lista do Dia 2

Foram **cadastradas na hora, no balcão do dia 1** (walk-ins criados em 04/08);
a lista do d2/d3 veio da planilha original e não as tem. Três delas já foram
credenciadas no dia 1, ou seja: compareceram e devem voltar.

- Antonio Vicente da Graça (credenciado)
- Giuliana Calegare (credenciada, comprador)
- Raquel Renata Ribeiro Rodrigues (credenciada, comprador)
- Bruno Gabriel Lima Rodrigues (não credenciado, comprador)

**O sistema não quebra**: ao escanear, aparece o card laranja *"QR de outro dia —
[nome] — Pertence a: ETHB SP — Dia 1"*.

**O que o operador deve fazer:** cadastrar a pessoa no dia de hoje pelo botão de
adicionar — o mesmo fluxo usado ontem. **Não** use o atalho de "trocar para o
Dia 1" que o card oferece: isso credenciaria a pessoa no dia errado e
sobrescreveria a hora de chegada dela do dia 1.

Se você preferir resolver antes de abrir o balcão, este SQL copia as quatro para
o d2 e o d3 (rode no SQL Editor do Supabase; é reversível apagando por nome):

```sql
insert into public.participantes (id, evento_id, nome, "nomeCracha", email, telefone,
  documento, cidade, estado, turma, profissao, instrucao, faturamento, tipo,
  "grupoDiamante", "convidadoPor", "tamanhoCamisa", grupo, pessoa_token,
  dados_extra, representante)
select replace(p.id, 'ethb-sp-d1', d.alvo), d.alvo, p.nome, p."nomeCracha", p.email,
  p.telefone, p.documento, p.cidade, p.estado, p.turma, p.profissao, p.instrucao,
  p.faturamento, p.tipo, p."grupoDiamante", p."convidadoPor", p."tamanhoCamisa",
  p.grupo, p.pessoa_token, p.dados_extra, p.representante
from public.participantes p
cross join (values ('ethb-sp-d2'), ('ethb-sp-d3')) as d(alvo)
where p.evento_id = 'ethb-sp-d1'
  and p.pessoa_token not in (select pessoa_token from public.participantes where evento_id = 'ethb-sp-d2')
on conflict (id) do nothing;
```

Não rodei por conta própria porque é decisão de negócio: só você sabe se essas
quatro têm direito aos dias 2 e 3.

## Segurança do banco (corrigido nesta madrugada)

Tabelas de **backup** estavam expostas ao papel `anon` sem RLS — qualquer um com
a chave pública podia ler e apagar:

- `cs_bkp_ethb_sync_20260803` (credenciamento, 45 linhas)
- `thb_alunos_bkp_20260730_reconciliacao` e `..._organizacao` (1.765 alunos cada)
- `_thb_revogar_20260730` (194 linhas)

RLS habilitado nas quatro. Nenhum código referencia essas tabelas (verificado por
busca nos repositórios) e o servidor usa `service_role`, que ignora RLS — os apps
foram testados depois da mudança e seguem de pé. As tabelas principais
(`participantes`, `eventos`, `thb_alunos`) já estavam protegidas.

Fica para depois do evento: a view `vw_eventos` é `SECURITY DEFINER` e legível por
`anon`, contornando o RLS das tabelas base. Expõe só nomes/datas/contagens de
eventos, não PII individual — por isso não mexi na véspera, já que ela está no
caminho do polling.

## O que a auditoria adversarial encontrou (e já está corrigido)

Uma revisão independente do próprio fix, antes do evento, achou três coisas —
uma delas **anterior a tudo isto** e capaz de apagar credenciamento confirmado:

1. **`flushFila` sobrescrevia a fila offline** (bug antigo, `src/offline.js`).
   Ele lia a fila no início e regravava o snapshot no fim; como cada envio pode
   pendurar até 12 s, num servidor lento o flush leva minutos — e tudo que o
   operador enfileirava nesse meio-tempo era apagado. A tela dizia "salvo
   offline", a pessoa entrava, e o banco nunca registrava. Sem aviso: o contador
   de pendentes até diminuía. Corrigido: o flush re-lê a fila antes de gravar.
2. **401 não enfileirava** — regressão da sessão de 12h. Credenciamento em voo no
   instante da expiração evaporava depois do beep verde. Agora vai para a fila.
3. **Scanner não contava como atividade** — regressão da pausa por ociosidade. Em
   modo quiosque não há toque na tela, então a lista congelava e o beep de
   duplicado deixava de soar. Agora cada leitura emite `chf:atividade`.

## Limitação conhecida: colisão de milissegundo

Se dois celulares gravarem no mesmo milissegundo e isso cair exatamente entre o
probe e a busca do delta, o `updated_at > since` deixa a segunda linha para trás
— e como o par (máximo, contagem) continua batendo, o servidor responderia
"nada mudou" indefinidamente. **O dado no banco fica correto** e o aparelho que
credenciou mostra o estado certo; o sintoma é outro operador ver a pessoa como
pendente.

Não tentei fechar a corrida no servidor (exigiria travar ou versionar a lista,
mudança grande na véspera do evento). A reconciliação de 10 minutos resolve na
prática: a divergência dura minutos, não o evento. Se alguém credenciar a mesma
pessoa duas vezes por causa disso, é inofensivo — a operação é idempotente.

## O que NÃO é o gargalo (não perca tempo aqui)

- **Auth**: 12 MB no dia (1,8%). As rajadas de `/auth/v1/user` do outro projeto
  são feias, mas irrelevantes em bytes.
- **Storage**: 8,5 kB. **Realtime**: 51 kB. Ruído.
- **Tabelas de backup** (`thb_alunos_bkp_*`, 9 delas): ocupam disco, não geram
  egress. Deixe para depois do evento.
- `thb_alunos` tem 7,3 kB por linha e 20 M de seq_scans: isso queima **CPU**,
  não egress. Merece índice depois do evento, não agora.

## Otimizações fora do credenciamento (05/08, madrugada)

| Onde | O que | Estado |
|---|---|---|
| `central-de-projetos` (SIP) | `prefetch={false}` no Sidebar | **no ar** |
| `gps-thb` | `prefetch={false}` no NavTabs | **no ar** |
| `central-de-projetos` (SIP) | logout após 30 min sem atividade | **no ar** |
| `gps-thb` | logout após 30 min sem atividade | **no ar** |
| `controle-de-eventos` (dashboard CNHF) | polling 30s → 60s + logout de 30 min | **no ar** |
| projeto Supabase 2 | 7 crons de analytics: 30 min → 1 h | **aplicado** |
| projeto Supabase 2 | `sync-clickup-hourly` (duplicata) desagendado | **aplicado** |
| 4 tabelas de backup | RLS habilitado (PII exposta ao `anon`) | **aplicado** |

**Correção:** o `DEPLOY.md` do `gps-thb` diz que o deploy é manual — **está
desatualizado**. A Hostinger tem integração git ativa naquele domínio: o push
disparou o deploy sozinho em 4 segundos.

Os crons de analytics ficaram com **minutos escalonados** (5, 10, 20, 25, 35, 45,
50) de propósito: evita o minuto 0/30 do `ingest-sendflow` e o minuto 15 do
`reconcilia-grupo` — os dois jobs críticos do ingresso no grupo, que **não foram
tocados** — e evita todos baterem no banco no mesmo instante.

O prefetch era o segundo maior consumidor: o menu fica visível em toda tela e o
Next pré-buscava as 7-8 rotas de uma vez; como são dinâmicas, cada pré-busca roda
o middleware e renderiza a página inteira. Medido nos logs: ~15 chamadas
`GET /auth/v1/user` + queries por navegação.

**`gps-thb` não tem deploy automático.** Para publicar: `git pull && npm install &&
npm run build` na Hostinger e reiniciar o app (ou `touch tmp/restart.txt`). Até
alguém fazer isso, o commit não reduz nada.

### De onde vinham os 137 MB do dia 05/08 (rastreado até a origem)

| Origem | MB | % |
|---|---|---|
| **Dashboard CNHF** (~150 carregamentos × 868 kB) | ~110 | **80%** |
| Crons do ingresso no grupo (`reconcilia` + `sync-grupo`) | ~22 | 16% |
| Credenciamento | ~1 | 0,7% |
| Auth + Realtime + Functions + Pooler | ~3 | 2% |

Cada carregamento de tela do dashboard dispara **9 endpoints que leem
`controle.lead_active` inteira** (7.612 linhas), cada um com um recorte de colunas
diferente e nenhum agregando no banco:

```
lead_active select(*) ......... 427 kB    grupo_evento .......... 101 kB
lead_active (telefone/nome) ... 134 kB    lead_active (segmento)   65 kB
lead_active (utm_content) ..... 125 kB    respostas_pesquisa ..... 16 kB
                                          ---------------------------------
                                          um carregamento ....... 868 kB
```

**Corrigido com cache de leitura de 60 s** no backend (`server/cache-leitura.js`).
Os dados vêm de crons horários, então 60 s serve exatamente o mesmo byte — só que
uma vez, em vez de uma por aba aberta. Ficam fora do cache: `/health` (mascararia
incidente), `/tarefa/:id`, qualquer método diferente de GET e qualquer resposta
diferente de 200. Erro dentro do hook deixa a request seguir normal.

O teste (13 casos contra um Fastify real, contando quantas vezes o handler roda)
**pegou um bug**: os regexes de exceção estavam ancorados em `^/health`, mas as
rotas vivem sob o prefixo `/api` — nunca casavam, e `/health` acabava cacheado.

### Varredura completa da organização (13 repositórios)

| Repositório | Consome? | Situação |
|---|---|---|
| `credenciamento-thb` | sim | corrigido (era 90% do problema) |
| `central-de-projetos` (SIP) | sim | prefetch + logout de 30 min no ar |
| `gps-thb` | sim | prefetch + logout de 30 min no ar |
| `controle-de-eventos` (dashboard CNHF) | sim | polling 60s + logout no ar |
| `rede-nacional-especialistas` (blog) | sim, pouco | **medido: 19 kB/visita** — ver abaixo |
| `central-de-alunos-ht` | sim | ~20-60 MB/dia — pendente, ver abaixo |
| `workbook-cnhf` | sim | não mexer (read-merge-write protege resposta de aluno) |
| `sip` (Documents\sip) | sim | polling já tem backoff e pausa em aba oculta |
| `disparos-thb` | sim | já remediado pelo time em 04/08 |
| `sistema-grupo-participa-v2` | não | sem cutover de domínio |
| `sip-thb` | não | sem deploy ativo (`/api/health` dá 404) |
| `clint-dashboard` | não | não usa Supabase (API do Clint) |
| `form-seminario` | não | repositório vazio |

**Blog institucional — alarme falso.** Uma análise apontou "100 MB a 3 GB/dia"
por causa do `force-dynamic` na home. Medido no banco: o catálogo tem 477
especialistas = 191 kB crus = **19 kB comprimidos por visita**. Com o tráfego real
de um site com **1 artigo publicado**, isso é alguns MB/dia. E trocar por
`revalidate` **não funcionaria**: as queries usam o client que chama `cookies()`,
o que força renderização dinâmica de qualquer jeito. Cachear exigiria um client
público separado — refatoração que não se paga na véspera de evento.

**`central-de-alunos-ht` (pendente, opcional).** `lib/admin.js:59` lê
`lesson_progress` inteira (todas as turmas históricas) e filtra em memória.
Corrigir é trocar por filtro no banco (`.in('lesson_id', idsAulas)`). Vale ~20-60
MB/dia, mas exige validar os consumidores do painel admin — não é uma linha. Fica
para depois do ciclo, já que o orçamento fecha sem isso.

### Descartado de propósito

- **`React.cache()` no `getUser()`** do central-de-projetos: tocaria 8 arquivos de
  autenticação por um ganho estimado abaixo de 3 MB/dia e não medido. Com a folga
  atual, é risco sem retorno.
- **Trocar `select('*')` por colunas**: a análise provou que a heurística quebra —
  em `trafego/page.tsx` o tipo `Traffic` tem 5 campos usados só na tela de edição
  (`CamposDoDia`), e cortá-los faria o aluno sobrescrever dado real com vazio.
- **Reduzir `reconcilia-grupo`**: medido em 36 MB nos 3 dias, e é o contador
  independente que pega furo de ingresso no grupo durante o lançamento.

## Orçamento para os 3 dias

Sobravam ~660 MB no momento do fix. Com o delta no ar, 3 celulares × 10 h de
balcão devem custar unidades de MB por dia, não centenas. A folga é de ordens de
grandeza — mas confira o painel uma vez por dia
(Reports → Usage → Egress) para não voar às cegas.
