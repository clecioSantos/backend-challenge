# Arquitetura

Implementação de referência do processador de apostas distribuído. Este documento
explica as decisões por trás do código, não o desafio em si. Leia-o em conjunto
com o `README.md` (a tarefa) e a árvore de código-fonte.

## 1. Objetivos e invariantes

O sistema deve permanecer correto enquanto mensagens são duplicadas, entregues
fora de ordem ou processadas concorrentemente. Concretamente, os quatro
invariantes globais são:

1. nenhum crédito ou débito duplicado;
2. nenhum evento confirmado perdido;
3. nenhum saldo negativo;
4. `wallet.balance` sempre igual ao saldo reconstruído a partir do ledger.

Toda decisão de design abaixo é justificada por um destes.

## 2. Camadas

```
http            NestJS controllers, DTOs, guards, filters  (apenas transporte)
application     use cases, ports, canonical JSON hashing
domain          Money, Wallet, WagerTransaction, ledger, inbox, outbox, events
infrastructure  MikroORM, SQS, workers, metrics, logging, clock
```

As dependências apontam para dentro. O domínio não importa nada do NestJS,
MikroORM ou AWS; persistência e mensageria entram por meio de ports definidos em
`application`. O exception filter e os controllers são os únicos lugares que
conhecem HTTP, e os adapters são os únicos lugares que conhecem o ORM ou o
broker.

Fronteiras notáveis:

- `Money` é um value object sustentado por `decimal.js`, nunca um `number`;
- os repositórios são definidos como interfaces no domínio e implementados em
  `infrastructure/persistence/repositories`;
- `UnitOfWork` (port) produz um `TransactionContext` com todos os repositórios
  vinculados à mesma transação SQL.

## 3. Money

- Armazenado e transportado como **string** decimal com escala fixa 2; a coluna
  `numeric(20,2)` mantém a representação no banco exata.
- A entrada é validada por uma regex estrita: sem sinal, sem expoente, no máximo
  2 casas decimais, no máximo 18 dígitos inteiros — o mesmo limite da coluna.
- `Money` é imutável; a aritmética retorna novas instâncias. Resultados
  intermediários podem ser negativos para que os chamadores possam comparar com
  zero, mas valores que entram no sistema (transações, créditos, débitos) devem
  ser estritamente positivos.
- Toda operação binária verifica se as moedas coincidem.
- `toJSON()` é o que cruza a rede, então os tipos de money do ORM nunca vazam
  para o domínio.

## 4. Wallet e ledger

A wallet é o aggregate root e a **unidade de concorrência**.

- `version` começa em 1 e só incrementa quando o saldo muda.
- `debit`/`credit` retornam a entrada de ledger que produziram, então uma
  mudança de saldo e sua linha de auditoria são criadas juntas e nunca podem
  divergir.
- A linha do ledger é estruturalmente imutável (sem setters, sem transições) e o
  schema a impõe com um trigger `before update or delete`.

O banco impõe o que o código promete:

| Garantia | Onde |
|---|---|
| uma wallet por `(playerId, currency)` | índice único `wallets_player_currency_uq` |
| saldo não negativo | check `wallets_balance_non_negative` |
| uma entrada de ledger por `(transaction, wallet)` | índice único `wallet_ledger_entries_transaction_wallet_uq` |
| aritmética de ledger não negativa | checks em `balance_before`/`balance_after` |
| aritmética exata do lançamento | check `wallet_ledger_entries_arithmetic_check` (`balance_before ± amount = balance_after`) |
| ledger append-only | trigger `wallet_ledger_entries_no_mutation` |
| sem reversão dupla da mesma referência pelo mesmo tipo | índice único parcial `wager_transactions_reversal_uq` (`reference_transaction_id`,`kind` onde `status='PROCESSED'`) |
| idempotency key e transação do provedor únicas | índices únicos em `wager_transactions` |

## 5. Concorrência

A estratégia escolhida é **pessimistic row locking na wallet**, combinada com
verificação otimista de versão e constraints únicas do banco como defesa em
profundidade.

- O caminho de entrada sempre faz `SELECT ... FOR UPDATE` na wallet
  (`findByIdForUpdate`) *antes* de ler a idempotency key. Duas requisições que
  tocam a mesma wallet são, portanto, serializadas; wallets diferentes seguem em
  paralelo.
- `save(wallet, expectedVersion)` também compara versões, então um caminho de
  programação que esqueça o lock ainda falha ruidosamente em vez de produzir um
  lost update.
- A ordenação de lock é fixa: **wallet primeiro, depois transaction**. O worker
  de referência pendente respeita a mesma ordem, o que evita deadlocks entre
  resume concorrente e a entrada da mesma wallet.
- Não há lock global: o recurso é o `walletId`, então wallets quentes se
  serializam e wallets frias escalam horizontalmente.

Isso é validado pelo cenário obrigatório (duas apostas de `80.00` sobre `100.00`:
uma `PROCESSED`, uma `REJECTED`, saldo `20.00`, um único débito) e por três
instâncias concorrentes da aplicação disputando uma wallet.

## 6. Idempotência

- O header `Idempotency-Key` é a fonte da verdade; o padrão é
  `"{providerId}:{externalTransactionId}"`.
- `payloadHash` é o SHA-256 de uma serialização **canonical JSON** (chaves de
  objeto ordenadas, `undefined` descartado) apenas dos campos de negócio.
  Metadados de transporte e headers são excluídos. Veja
  `application/crypto/canonical-json.ts`.
- Uma requisição com uma key conhecida e o mesmo hash reproduz o resultado
  original, incluindo o saldo observado na época. Uma key conhecida com um hash
  diferente é um `IDEMPOTENCY_CONFLICT`, nunca um replay.
- A deduplicação **não** depende de um cache em memória: é o índice único em
  `idempotency_key` mais o inbox persistente.

## 7. Referências e entrega fora de ordem

- `REFUND`/`ROLLBACK` exigem `referenceExternalTransactionId`. A referência é
  resolvida por `(providerId, referenceExternalTransactionId)` e deve
  corresponder a provedor, jogador, wallet, moeda e rodada; o valor deve ser
  igual.
- Uma reversão que chega antes de sua referência é armazenada como
  `PENDING_REFERENCE` com um cronograma de backoff exponencial
  (`next_reference_attempt_at`) e um contador de tentativas limitado.
- Um worker agendado reencaminha as linhas vencidas pelo *mesmo* use case. Após
  o limite de tentativas, a transação é rejeitada com `REFERENCE_NOT_FOUND` e um
  evento é emitido. O limite de tentativas é 8 com base de 2s / cap de 5min
  (env vars `PENDING_REFERENCE_*`).
- Uma referência só pode ser revertida uma vez por tipo de reversão
  (`REFERENCE_ALREADY_REVERSED`).
- Uma reversão que levaria o saldo a negativo é rejeitada com
  `REVERSAL_WOULD_GO_NEGATIVE`, deliberadamente distinta de
  `INSUFFICIENT_FUNDS`.

## 8. Inbox / outbox

A mudança de uma wallet, sua entrada de ledger, a reivindicação do inbox (para
entrada da fila), a linha da transação e os eventos do outbox são gravados em
**uma única transação SQL** por meio de `UnitOfWork.run`.

- **Inbox**: `ON CONFLICT DO NOTHING` em `(consumerName, messageId)` reivindica
  a mensagem; `processed_at` é definido logo antes do commit. Se a transação for
  revertida, a reivindicação também é revertida, então a reentrega é segura. Um
  duplicado que encontra a mensagem já processada reproduz o resultado original
  da transação.
- **Outbox**: os eventos são inseridos na mesma transação. Um worker reivindica
  as linhas vencidas com `FOR UPDATE SKIP LOCKED`, as publica, as marca como
  publicadas e faz commit. Manter o lock durante o publish garante que dois
  publicadores não enviem a mesma linha; um crash após o commit mas antes do
  publish deixa a linha pendente para o próximo tick. Um publish que tem sucesso
  mas cujo commit falha é retentado e é seguro porque os consumidores
  deduplicam.
- **Os eventos do outbox vão para uma fila dedicada (`wager-events.fifo`)**,
  nunca para a fila de requisições. Se fossem para a fila de entrada, o próprio
  consumidor reinterpretaria um `WagerTransactionProcessed` como uma nova
  `WagerTransactionRequested`. As duas filas são separadas por contrato.
- Nenhum evento é publicado antes de a transação financeira fazer commit.

As chamadas de repositório que devem ser transacionais usam
`EntityManager.execute` (transaction-aware) em vez de
`getConnection().execute`, para que a reivindicação do inbox faça parte da mesma
transação.

## 9. Mensageria (SQS)

- As filas são FIFO — `wager-transactions.fifo` (ingress de requisições),
  `wager-transactions-dlq.fifo` (mensagens envenenadas) e `wager-events.fifo`
  (eventos do outbox) — para ordenação otimista e agrupamento por aggregate
  (`aggregateId` = message group id, event id = deduplication id). O FIFO é
  tratado apenas como uma otimização — a correção repousa sobre o banco.
- O consumidor reutiliza exatamente o mesmo use case do HTTP. Ele faz ack
  (`DeleteMessage`) somente após o commit.
- Classificação de falhas:
  - erros de negócio/validação e estado desconhecido → terminal → DLQ;
  - `InfrastructureError` marcado como non-retryable → DLQ;
  - falhas transientes → `ChangeMessageVisibility` com backoff exponencial,
    controlado por `SQS_MAX_RECEIVE_COUNT`; a broker redrive policy é o último
    recurso;
  - payloads malformados → DLQ imediatamente.
- Cada mensagem enviada à DLQ usa um message group id próprio: a DLQ não precisa
  de ordenação, e assim uma mensagem não bloqueia a entrega das demais
  (*head-of-line blocking* de FIFO).
- No `SIGTERM`, o loop para de agendar novos polls e termina o lote em trânsito;
  qualquer coisa não confirmada com ack torna-se visível novamente e é
  reentregue. O `stop()` do agendador cancela o timer pendente e aguarda apenas a
  execução em andamento, para que o shutdown não dependa do intervalo
  configurado.

## 10. Taxonomia de falhas

`FailureCode` é estável e legível por máquina, agrupado pela ação que um provedor
deve tomar (`FailureDisposition`: `resend`, `fix_payload`, `give_up`). O mapeamento
de disposição está em `domain/shared/failure-code.ts`, então um provedor nunca
precisa interpretar mensagens humanas.

## 11. Mapeamento de status HTTP

| Situação | Status |
|---|---|
| body/query inválidos | 400 |
| conflito de idempotência, wallet já existe | 409 |
| rejeição de negócio (sem fundos, referência inválida, ...) | 422 |
| aceito, referência pendente | 202 |
| não encontrado | 404 |
| optimistic lock / infraestrutura transiente | 503 |
| inesperado | 500 |

Todos os mapeamentos ficam em `http/filters/all-exceptions.filter.ts`.

## 12. Autenticação

A autenticação não gera pontuação e intencionalmente não é implementada como um
armazenamento local de usuários. O ponto de extensão é `ProviderIdentityPort`: o
`AnonymousProviderIdentityAdapter` padrão retorna anonymous e o
`ProviderIdentityGuard` anexa uma identidade quando uma é resolvida. Trocar o
adapter por uma implementação OIDC/JWKS (Keycloak, Zitadel, ...) é a única
mudança necessária; os endpoints de health são abertos e não usam o guard.
Mensagens vindas da fila são um canal interno confiável, mas a identidade do
provedor que elas carregam ainda está sujeita a todas as validações de domínio.

## 13. Observabilidade

- Logs JSON estruturados via `nestjs-pino`, com request correlation ids e
  redação de headers de autorização e payloads financeiros. Os logs do
  consumidor SQS e dos workers carregam de forma consistente `correlationId`,
  `messageId`, `transactionId`, `walletId` e `providerId`.
- Métricas Prometheus (`GET /metrics`): transações por status, duplicados,
  retries, conflitos de lock (`wagering_lock_conflicts_total`, emitido pelo
  repositório quando a checagem otimista falha), mensagens em DLQ, histograma de
  latência de processamento, gauges de outbox pendente/outbox lag e
  `wagering_reconciliation_divergences_total` (divergências de reconciliação).
- `GET /health/live` (processo) e `GET /health/ready` (PostgreSQL + SQS).
- Divergências de reconciliação não são corrigidas silenciosamente: aparecem na
  resposta, na métrica e em log estruturado.

## 14. Testes

- **Unit** (sem containers): `Money` (escala, arredondamento, entradas
  inválidas), invariantes de `Wallet`, verificação de saldo do ledger, máquina de
  estados da transação e regras de tipo.
- **Integration** (PostgreSQL real + LocalStack real): migrations/constraints
  (unicidade, checks, trigger append-only, índice de reversão e `up`/`down` das
  migrations), o ciclo de vida completo da aposta, referências, reentrega do
  inbox e concorrência, atomicidade da unit of work, particionamento do outbox
  entre publicadores concorrentes, retry/backoff e DLQ, e o consumidor SQS de
  ponta a ponta.
- **Concurrency** (transações reais em paralelo): o cenário da seção 8, a mesma
  aposta entregue 50 vezes em paralelo, wallets distintas em paralelo e três
  instâncias concorrentes da aplicação. Todo teste verifica o invariante final de
  reconciliação.

Rode `bun run test` com a infraestrutura no ar. A suíte exige PostgreSQL e
LocalStack reais; ela nunca os substitui por mocks.

## 15. Experimento de carga

`bun run test:load` dirige o caminho processado real com um worker pool e imprime
ambiente, throughput, p50/p95/p99, taxa de erro, conflitos de lock, outbox lag e
uma reconciliação final. É deliberadamente honesto: os resultados dependem do
host e dos limites de recursos do Docker, e os números acima não são uma meta. Os
parâmetros são configuráveis por meio de `LOAD_WALLETS`, `LOAD_OPERATIONS`,
`LOAD_CONCURRENCY` e `LOAD_AMOUNT`.

## 16. Trade-offs e limitações

- **Pessimistic locking** limita o throughput de uma única wallet quente
  (serializada por design) em troca de simplicidade e forte correção. Um design
  fragmentado (sharded) ou uma fila por wallet estava fora do escopo.
- **O FIFO não é estrutural.** O sistema é correto mesmo sob filas padrão e
  entrega fora de ordem; a ordenação é apenas uma otimização.
- **O publicador do outbox mantém um row lock enquanto chama o SQS.** Isso torna
  "exatamente um publicador por linha" trivial, mas acopla o tempo de retenção do
  lock à latência do broker. Se isso algum dia prejudicar, a alternativa é uma
  reivindicação em duas fases (coluna `lockedUntil`) ao custo de mais estados.
- **A resolução de referência é pelo id externo do provedor**, que é o que o
  provedor conhece; um id interno seria mais rápido, mas não sobreviveria ao
  contrato at-least-once e fora de ordem.
- **Sem event sourcing.** O ledger é append-only, mas a wallet é um read model
  materializado com um reconciler, o que é mais simples de operar.
- Os workers de polling no processo são single-threaded; a escala horizontal é
  feita rodando várias instâncias (o design com SKIP LOCKED dá suporte a isso).
