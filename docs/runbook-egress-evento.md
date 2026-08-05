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

1. **Todos os operadores vão precisar logar de novo.** A sessão agora expira em
   12h e a de hoje foi criada ontem. A senha é a mesma de sempre — só o login
   que voltou a ser pedido. Avise a equipe para não parecer que "quebrou".
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

## Orçamento para os 3 dias

Sobravam ~660 MB no momento do fix. Com o delta no ar, 3 celulares × 10 h de
balcão devem custar unidades de MB por dia, não centenas. A folga é de ordens de
grandeza — mas confira o painel uma vez por dia
(Reports → Usage → Egress) para não voar às cegas.
