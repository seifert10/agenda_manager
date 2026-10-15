# Plano de implementação multiempresa — Folga Manager

Data: 12/10/2026. Estado: implementação integrada, interface, provisionamento e homologação local concluídos, incluindo PostgreSQL real com runtime restrito, pool e dump/restore. Corte do banco atual e publicação P9 pendentes do ambiente/destino. Consulte `multiempresa-execucao.md`.

Este documento é o roteiro de execução. O planejamento original foi somente documental; após autorização do usuário, iniciou-se a implementação registrada em `multiempresa-execucao.md`. O banco atual e a infraestrutura não foram migrados.

## 1. Objetivo e decisões de arquitetura

Permitir que empresas independentes usem a mesma aplicação, sem consultar, modificar, inferir por mensagens de erro ou exportar dados umas das outras. Preservar o controle por setores dentro de cada empresa e os recursos atuais de escalas, folgas, recorrências, relatórios e feriados.

### Arquitetura recomendada

Manter React + Express + TypeScript e o monólito atual. Em produção, usar PostgreSQL com tabelas compartilhadas, coluna obrigatória `company_id`, autorização na aplicação e Row-Level Security (RLS) no banco. Não criar microsserviços nesta etapa.

| Alternativa | Avaliação para este projeto |
| --- | --- |
| Tabelas compartilhadas, empresa por registro e RLS | Escolhida: facilita migrações e aproveita PostgreSQL já suportado; exige disciplina de escopo e testes de isolamento |
| Schema por empresa | Adiciona gestão de schemas e migrações sem justificar a complexidade inicial |
| Banco por empresa | Maior separação operacional e restauração individual mais simples, com maior custo de conexões, provisionamento e migrações; alternativa futura se houver exigência de isolamento físico |

O isolamento proposto é lógico. A infraestrutura e os backups globais continuam sob administração da plataforma. Nenhuma empresa terá acesso ao banco, às credenciais operacionais ou ao backup global. Se o requisito passar a exigir banco dedicado, região exclusiva ou criptografia com chave individual, rever esta decisão antes de implementar.

### Premissas adotadas para tornar o plano executável

- Uma conta de usuário pertence a exatamente uma empresa. Não haverá identidade compartilhada entre empresas nesta versão.
- O mesmo e-mail pode existir em empresas diferentes, com credenciais, permissões e sessões independentes.
- Login solicita código da empresa, e-mail e senha. Código público não é segredo nem autorização.
- Cada sessão pertence a uma única empresa. Acesso a outra empresa exige novo login; não haverá troca de empresa por header ou seletor dentro da sessão atual.
- `ADMIN` significa administrador da própria empresa. `MANAGER` e `VIEWER` continuam restritos aos setores autorizados.
- Provisionamento de empresas será uma operação administrativa interna, auditada, fora da interface dos clientes. Não criar um superadministrador com acesso irrestrito aos dados de todas as empresas na interface comum.
- Fuso inicial: America/Sao_Paulo para todas as empresas. Suporte a fusos diferentes fica fora desta entrega.
- Cadastro público, cobrança, convites por e-mail, SSO, grupos econômicos, transferências de dados entre empresas e feriados locais personalizados ficam fora desta entrega.

Essas são decisões propostas, não requisitos previamente confirmados sobre a operação comercial. O executor deve mantê-las como padrão; mudança de premissa exige revisão explícita do plano, não improvisação no meio da implementação.

## 2. Diagnóstico confirmado no código

O projeto já suporta PostgreSQL para produção, SQLite local, migrações versionadas, transações, testes isolados e notificações com leitura individual. `docs/arquitetura-atual.md` é histórico: várias limitações ali descritas já foram corrigidas. O código atual é a fonte de verdade.

| Ponto atual | Consequência para multiempresa |
| --- | --- |
| Não há entidade empresa nem `company_id` | Nenhum recurso de negócio possui uma fronteira de empresa |
| `requireAuth` carrega todos os setores para ADMIN | O administrador atual possui alcance global |
| `hasDepartmentAccess` e `hasEmployeeAccess` liberam ADMIN antecipadamente | IDs externos poderiam ser aceitos sem validar pertencimento |
| Login pesquisa apenas e-mail | Não distingue contas de empresas diferentes |
| CPF, e-mail, nome de setor e chave de configuração têm unicidade global | Empresas independentes não conseguem repetir valores legitimamente |
| `settings` e bootstrap são globais | Nome da empresa, regras e onboarding seriam compartilhados |
| Serviços de notificações e cobertura de feriados consultam dados amplos | Filtrar apenas depois da consulta é insuficiente para a nova fronteira |
| Chave de notificação de feriado usa apenas data/etapa | Empresas podem colidir na geração e na leitura |
| Rotas e serviços acessam `db` diretamente | Escopo precisa ser aplicado em todos os caminhos, não somente nos endpoints principais |
| Conexão já usa AsyncLocalStorage e fixa conexão nas transações | Pode acomodar contexto de empresa, mas rejeita transações aninhadas atualmente |
| Inicialização executa migrações e bootstrap | Precisa separar credenciais e processo de migração do runtime com RLS |
| Frontend usa token e usuário globais em localStorage | Pode exibir estado antigo após logout/login ou mudança de conta em outra aba |

Preservar as alterações de feriados existentes no diretório de trabalho e os arquivos não rastreados do usuário. Não limpar o repositório, sobrescrever trabalho anterior ou refazer funcionalidades existentes.

## 3. Regras obrigatórias de isolamento

1. Toda operação de negócio exige contexto autenticado e imutável de empresa.
2. O identificador de empresa utilizado em consultas e gravações vem da sessão validada no servidor. Campos de empresa enviados pelo cliente em mutações comuns devem ser rejeitados.
3. Autorização combina empresa, perfil e setor. Ser ADMIN elimina somente a restrição de setores da própria empresa.
4. Consultar primeiro dentro da empresa. Um ID de outra empresa deve produzir a mesma resposta de um ID inexistente, normalmente 404.
5. Gravações e relacionamentos cruzados devem falhar também por constraints do banco.
6. Agregações, contadores, buscas, exportações, regras de descanso, auditoria e avisos precisam do mesmo isolamento dos cadastros.
7. `department_id` nulo pode significar alcance de toda a empresa; nunca alcance entre empresas. `company_id` não pode ser nulo em dados de negócio.
8. Dados de uma empresa não podem ser carregados para depois serem descartados por filtro JavaScript.
9. Tarefas internas e futuros jobs devem receber uma empresa explícita. Não permitir modo global implícito ou fallback para a primeira empresa.
10. O contexto da conexão deve terminar com a transação; nenhuma requisição pode herdar o contexto anterior do pool.
11. Mutação de domínio e auditoria devem ser atômicas. Falha de auditoria deve desfazer a operação.
12. Ausência de contexto é falha fechada: sem acesso a dados; nunca consulta global.

## 4. Modelo de dados alvo

Manter os IDs atuais das entidades. Adicionar uma empresa por registro e chaves compostas para garantir que relações pertençam à mesma empresa. Não renumerar registros existentes.

| Tabela | Mudança planejada | Unicidade / integridade |
| --- | --- | --- |
| `companies` — nova | ID, código público normalizado, nome, estado ativo/suspenso, datas de criação/atualização | Código único; ID estável; sem exclusão física nesta versão |
| `users` | Empresa obrigatória; perfil e ativação continuam locais | Empresa + e-mail normalizado; empresa + ID para referências |
| `user_sessions` | Empresa e usuário vinculados; expiração; armazenar hash do token aleatório | Hash único; referência composta ao usuário; sessão não pode mudar de empresa |
| `departments` | Empresa obrigatória | Empresa + nome normalizado; empresa + ID para referências |
| `user_departments` | Empresa obrigatória | Empresa + usuário + setor; referências compostas para ambos |
| `employees` | Empresa obrigatória; remover setor padrão com ID fixo | Empresa + CPF normalizado; referência composta ao setor |
| `days_off` | Empresa obrigatória | Empresa + colaborador + data; referência composta ao colaborador |
| `work_schedules` | Empresa obrigatória | Empresa + colaborador + data; referência composta ao colaborador |
| `settings` | Empresa obrigatória | Empresa + chave; upserts usam essa combinação |
| `notifications` | Empresa obrigatória; setor opcional | Empresa + source_key para deduplicação; referências de negócio validadas no mesmo escopo |
| `notification_reads` | Empresa obrigatória | Empresa + notificação + usuário; referências compostas para notificação e usuário |
| `audit_logs` | Empresa obrigatória e permanente; manter snapshots legíveis | Referências opcionais nunca podem apontar para outra empresa |
| `schema_migrations` | Continua global e exclusiva do processo de migração | Sem acesso pelo runtime normal |
| Registro de operações da plataforma — novo | Criação/suspensão/reativação de empresas e operador responsável | Separado da auditoria operacional dos clientes; sem conteúdo de RH |

Definir um único nome canônico em `companies`. Migrar `settings.company_name` para esse campo; adaptar a interface/API para não manter duas fontes concorrentes. Demais configurações e `onboarding_completed` continuam por empresa.

Definir normalização consistente: e-mail com trim e minúsculas; CPF apenas dígitos; código da empresa com alfabeto restrito; nome de setor com política estável de caixa/espaços. Detectar colisões antes de criar constraints. Não normalizar silenciosamente dois registros existentes para o mesmo valor.

Adicionar índices guiados pelas consultas: empresa/data; empresa/colaborador/data; empresa/setor; empresa/estado do colaborador; empresa/data de auditoria; empresa/source_key; sessões por empresa/usuário. Consultas por empresa são o padrão, inclusive joins e contagens.

### Referências e exclusões

- Adicionar chave única de empresa + ID nos pais e referências compostas nos filhos, mesmo mantendo o ID global como chave primária.
- Empresa de um registro é imutável nas operações comuns. Não criar endpoint genérico para transferir colaborador, usuário ou setor entre empresas.
- Remover defaults que atribuem setor 1. O setor informado deve existir na empresa corrente.
- Auditoria não deve perder `company_id` quando usuário, colaborador ou setor são excluídos. Não aplicar SET NULL ao par inteiro empresa/ID. Usar desativação quando possível ou limpar apenas a referência opcional de forma transacional antes da exclusão, conservando snapshots e empresa. Implementar a mesma semântica nos dois bancos.
- Relações polimórficas, como `related_id` e `entity_id`, não são protegidas apenas por uma FK genérica. Validar sua resolução no escopo da empresa e impedir que links consultem recursos globais.
- Retenção de dados de empresa suspensa: preservar registros; rejeitar acesso de seus usuários. Exclusão definitiva precisa de projeto posterior com regras de retenção próprias.

## 5. Autenticação e fronteira do banco

### Login e sessão

Login recebe código da empresa, e-mail e senha. A resolução inicial identifica somente a empresa candidata e a conta dentro dela. Usar a mesma mensagem de falha para empresa inexistente/suspensa e credenciais inválidas. Não disponibilizar uma lista pública de empresas ou a relação de empresas de um e-mail.

Após validar as credenciais, criar sessão vinculada à empresa e ao usuário. `/auth/me` retorna a empresa, o perfil e somente os setores locais. Cada requisição valida expiração, usuário ativo e empresa ativa; alterações de perfil/setores passam a valer na requisição seguinte. Logout revoga somente a sessão apresentada. Suspensão invalida as sessões da empresa; reativação exige novo login.

Manter token Bearer nesta entrega para limitar mudanças. Armazenar somente hash do token no banco e manter o valor bruto apenas no cliente durante seu uso. A adoção de cookies HttpOnly e proteção CSRF deve ser tratada separadamente, sem pressupor que o armazenamento atual resolve todos os riscos de sessão.

### Resolver a autenticação antes de ativar RLS

Há uma dependência circular a resolver: a sessão identifica a empresa, mas a tabela de sessões também deve ser protegida. Definir um pequeno módulo de resolução de autenticação, com funções de banco de privilégio restrito:

- Procurar uma conta candidata por código de empresa e e-mail normalizado; devolver ao backend apenas os campos necessários à verificação de senha.
- Resolver uma sessão pelo hash completo do token; devolver apenas empresa, usuário, validade e estados necessários à autenticação.
- Essas operações não listam tabelas, não recebem SQL livre, não acessam dados de colaboradores e não expõem hashes de senha na API.
- Se forem funções SECURITY DEFINER: usar proprietário dedicado, privilégios mínimos, objetos qualificados, search_path fixo e execução revogada de PUBLIC. Não conceder ao runtime uma credencial geral capaz de ignorar RLS. Revisar as exceções individualmente.
- Depois de resolver a empresa, leituras de perfil/setores, criação/revogação de sessões e operações comuns ocorrem no contexto restrito correspondente.

O módulo de autenticação é uma exceção pequena e explícita ao acesso por empresa. Não transformar essa exceção em uma função genérica de consultas privilegiadas.

### Papéis operacionais

Separar a credencial de migração/provisionamento da credencial do servidor HTTP. O runtime não pode ser proprietário das tabelas, superusuário, BYPASSRLS, nem executar DDL/TRUNCATE. A aplicação não deve carregar a credencial de migração para atender requisições.

RLS deve cobrir leitura e escrita nas tabelas de negócio. Ausência de empresa deve negar acesso. FORCE ROW LEVEL SECURITY evita a exceção usual do proprietário; superusuários e BYPASSRLS continuam sendo exceções e precisam ser excluídos do runtime. Verificar políticas com o papel real da aplicação. [Documentação PostgreSQL: RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

Usar configuração local à transação na conexão reservada para a empresa. SET LOCAL dura somente até o fim da transação; a operação precisa ocorrer na mesma conexão. Não usar configuração de sessão persistente em conexões reutilizadas. [Documentação PostgreSQL: SET](https://www.postgresql.org/docs/current/sql-set.html).

RLS complementa os filtros e a autorização na aplicação. O papel compartilhado de runtime e a resolução de contexto ainda dependem de backend confiável; não apresentar essa arquitetura como proteção contra comprometimento completo do servidor ou credenciais operacionais.

### Integração com as transações atuais

`server/db/connection.ts` já rejeita transações aninhadas. Antes de envolver operações em contexto de empresa, estabelecer uma única unidade de trabalho responsável por reservar conexão, começar transação, fixar empresa, concluir/abortar e liberar conexão.

Serviços internos reutilizam essa unidade de trabalho. Tentativa de trocar empresa dentro dela falha. Não abrir segunda transação automaticamente. Se houver necessidade real de savepoint, implementá-lo explicitamente e testar; não ocultar falhas com commits parciais.

Não manter transação aberta durante a transmissão de CSV ou comunicação externa. Preparar o resultado autorizado, concluir a transação e só então responder; não enviar sucesso HTTP antes do commit. Nas rotas que hoje usam `res` dentro da transação, separar produção do resultado e envio da resposta.

Preferir um módulo de acesso a dados que exija contexto explícito nos seus métodos. Restringir importação direta de `db` às camadas autorizadas, com verificação estática. Não tentar acrescentar filtros de empresa por substituição textual de SQL.

SQLite mantém filtros, constraints e testes de domínio, mas não fornece a mesma defesa RLS. PostgreSQL real, com papéis não privilegiados e pool, é obrigatório para validar a entrega em produção; o PGlite existente é complementar.

## 6. Contratos e experiência de uso

| Superfície | Comportamento alvo |
| --- | --- |
| Login | Novo campo código da empresa; contas de demonstração identificam sua empresa somente no ambiente de testes/desenvolvimento |
| `/auth/me` e resposta de login | Empresa atual com ID, código e nome; usuário, perfil e setores locais |
| Recursos `/employees`, `/days-off`, `/schedules` | Empresa derivada da sessão; validação do objeto e de todas as referências |
| `/users` e `/departments` | Administração restrita à empresa; impedir vínculo com setor externo |
| `/settings` | Configurações da empresa; alteração do nome canônico por fluxo autenticado de ADMIN |
| `/dashboard`, `/reports`, `/audit` | Todas as consultas, totais, filtros e exportações limitados à empresa |
| `/notifications` | Geração e leitura locais; sem colisão de chaves entre empresas |
| `/holidays` | Datas nacionais públicas podem permanecer compartilhadas em memória, atrás da autenticação atual |
| `/holidays/summary` | Cobertura e resumos calculados exclusivamente com dados da empresa e setores autorizados |
| `/health` | Continua sem autenticação; não informa empresas, usuários ou contagens de negócio |

Não é necessário acrescentar company_id a todos os parâmetros da API: o contexto da sessão é a autoridade. Se houver código de empresa na URL por conveniência, ele nunca pode substituir esse contexto.

No frontend, mostrar o nome da empresa no cabeçalho e tornar claro qual conta está ativa. No logout/login, desmontar o estado autenticado: seleção de colaboradores, filtros, resultados, notificações, modais e navegação. Ignorar respostas antigas que terminarem depois da troca de sessão; cancelar requisições quando possível.

Chaves de cache e armazenamento devem incluir empresa e usuário quando guardarem dados de negócio. Para o token compartilhado em localStorage, tratar evento de alteração entre abas: limpar estado e revalidar a nova sessão antes de renderizar ou permitir edição. Uma aba não pode continuar mostrando A enquanto envia alterações usando o token de B. Não persistir respostas de RH em armazenamento comum.

## 7. Sequência de implementação para o executor

Os checkboxes registram tarefas implementadas e verificadas. O aceite de uma fase depende também das tarefas abertas e da integração completa; componentes testados isoladamente ainda não significam ativação na aplicação. Evidências e limitações estão em `multiempresa-execucao.md`.

### P0 — Inventário e preparação
- [x] Revisar o estado atual do Git e as instruções locais; preservar alterações existentes.
- [x] Inventariar tabelas, rotas, serviços, tarefas, exportações, armazenamento e todos os acessos a `db`.
- [x] Registrar uma matriz recurso × operação × empresa × perfil × setor.
- [x] Estabelecer baseline de build/testes com bancos isolados.
- [x] Confirmar a procedência dos dados atuais e a empresa de destino da migração. Usuário confirmou dados mockados; destino de demonstração demo. Produção exige configuração explícita.

Aceite: inventário inclui as funcionalidades de feriados e nenhum caminho de negócio fica sem responsável. Dependência: nenhuma.

### P1 — Schema e migração aditiva
- [x] Criar `companies` e registro de operações administrativas da plataforma. Schema alvo verificado nos dois bancos.
- [x] Preparar migração versionada para novas colunas, índices e constraints nos dois bancos. Versão 3 ensaiada sobre legado descartável; reconstrução transacional preserva IDs.
- [x] Mapear dados existentes para uma empresa inicial explicitamente identificada. Ensaio usa demo; corte real exige destino explícito.
- [x] Ajustar unicidades globais para locais, normalização e chaves estrangeiras compostas. Verificadas no schema alvo e na cópia migrada.
- [x] Definir invariantes de auditoria e exclusão; remover default de setor fixo. Exclusão de colaborador limpa somente referência opcional e mantém empresa, setor e snapshots; testada nos dois bancos.
- [x] Revisar tradutor SQL e registro `identityTables` em `connection.ts` para as tabelas novas. Inserções de empresas verificadas nos dois dialetos.
- [x] Validar backup/restauração SQLite e PostgreSQL legado em bancos descartáveis, integrar comando operacional e preparar procedimento de corte.
- [ ] Executar o corte no banco/ambiente escolhido, conforme P9; destino, janela e evidência operacional ainda necessários.
- [x] Ensaiar backup físico SQLite em banco descartável, conferir integridade/referências/conteúdo restaurado e bloquear runtime/seed legados após migração.

Aceite: banco novo e cópia migrada têm integridade equivalente, IDs preservados, nenhuma linha sem empresa e nenhuma relação cruzada. Dados ambíguos interrompem migração. Dependência: P0.

### P2 — Contexto de empresa e acesso ao banco
- [x] Criar contexto imutável validado no servidor e exigir unidade de trabalho autenticada nos novos repositórios administrativos.
- [x] Migrar todos os acessos de negócio para a camada com escopo obrigatório.
- [x] Adaptar unidade de trabalho e chamadas transacionais existentes sem aninhamento acidental.
- [x] Separar credenciais/processos de runtime, migração e provisionamento.
- [x] Definir resolução restrita de autenticação e políticas RLS, inicialmente em ambiente isolado. Inclui companies; papel resolvedor sem acesso a RH.
- [x] Definir concessões mínimas do runtime e checagem de papel/schema: recusa superusuário, BYPASSRLS, associação ao resolvedor/proprietário, ausência de RLS, DDL/TRUNCATE e acesso a tabelas operacionais. Verificado em PostgreSQL embarcado e no PostgreSQL real local; login de runtime restrito separado também ensaiado.
- [x] Testar falta de contexto, contexto inválido, tentativa de troca e reutilização do pool após erro.

Aceite: consulta de negócio sem contexto falha; nenhuma requisição pode herdar empresa anterior; falta de filtro explícito é barrada pela RLS em PostgreSQL. Dependência: P1.

### P3 — Login, sessão e administração de usuários
- [x] Implementar e testar login, `/me`, logout e executor HTTP autenticado para conta local à empresa.
- [x] Armazenar hash de sessão no schema alvo e descartar sessões legadas durante o ensaio de migração.
- [x] Implementar helpers que verificam empresa antes da autorização de ADMIN; setor externo e colaborador externo retornam 404.
- [x] Limitar criação/edição/desativação de usuários e concessão de setores à própria empresa nas APIs novas.
- [x] Preservar ao menos um ADMIN ativo por empresa, inclusive sob duas requisições concorrentes; transação e bloqueio da empresa, com revalidação do ator após o bloqueio. Verificado em SQLite, PGlite e HTTP concorrente no PostgreSQL real com três conexões.
- [x] Manter limitação por IP e acrescentar chave empresa/e-mail normalizados ao login novo. Teste HTTP verificou limite específico e variação do código sem contornar o limite global por IP.
- [x] Substituir auth/middleware/helpers legados em todas as rotas e ativar o router novo somente com a integração completa.
- [x] Verificar concorrência no PostgreSQL real com pool.

Aceite: mesmo e-mail funciona em A e B com contas independentes; ADMIN de A não administra B; suspensão e revogação impedem novas operações. Dependência: P2.

### P4 — Cadastros, folgas e escalas
- [x] Implementar e testar APIs de setores e configurações por empresa, com nome canônico em companies e auditoria atômica.
- [x] Implementar e testar os routers multiempresa de colaboradores e setores com contexto obrigatório. Inclui listagem, perfil, CRUD, CPF local e autorização de origem/destino na transferência de setor.
- [x] Substituir os routers legados de colaboradores/setores na ativação conjunta do backend completo.
- [x] Implementar e testar folgas, recorrências e lotes no router novo; validar cada referência antes de escrever.
- [x] Implementar e testar escalas, conflitos, DSR, cobertura e configurações com escopo no fluxo novo.
- [x] Garantir rollback integral de lote com colaborador externo ou duplicidade intermediária; nenhuma auditoria parcial.
- [x] Garantir auditoria atômica e empresa imutável nas operações novas; falha intermediária na recorrência desfaz todas as gravações.
- [x] Ativar routers novos de folgas/escalas na aplicação completa e homologar concorrência de bloqueios no pool real.

Aceite: operações existentes funcionam dentro da empresa; IDs forjados e referências cruzadas não alteram nenhuma das empresas. Dependência: P3.

### P5 — Leituras agregadas, feriados e notificações
- [x] Implementar e testar dashboard, busca de colaboradores, histórico, relatórios e CSV com escopo desde o SQL nos routers novos.
- [x] Implementar serviços novos de notificações e cobertura de feriados sem consultas globais; nenhum serviço legado de leitura é chamado pelo fluxo novo.
- [x] Usar unicidade empresa/source_key, mantendo leitura individual por usuário; mesmo feriado em A/B possui IDs e recibos independentes.
- [x] Limitar leitura em lote de notificações à empresa e setores do usuário; teste verifica os recibos gravados e ausência de efeito em B.
- [x] Separar calendário público de feriados dos dados privados de cobertura; testes verificam contagens distintas por empresa e setor.
- [x] Testar configurações de descanso distintas em A/B; alerta após três dias em B e seis em A sem interferência.
- [x] Integrar os routers de leituras agregadas/notificações ao app completo, revisar índices/planos e homologar com pool real.
- [x] Compor todos os routers novos em server/company-app.ts, com guard de schema/privilégios antes de criar o app. Jornada HTTP verificada nos dois bancos, incluindo usuário sem setor; startup em server/index.ts usa exclusivamente esta composição; schema atual aguarda corte.

Aceite: contadores, CSV, avisos e feriados não contêm nomes, IDs ou totais externos; ler aviso em A não altera B. Dependência: P4.

### P6 — Interface e estado de sessão
- [x] Atualizar tipos, cliente API, contexto de autenticação e login.
- [x] Exibir empresa ativa e atualizar configurações/nome da empresa.
- [x] Limpar estado na mudança de sessão e tratar concorrência entre abas e respostas atrasadas.
- [x] Revisar CommandPalette, cabeçalho, notificações, filtros de setores e parâmetros de navegação.
- [x] Validar jornada ADMIN/MANAGER/VIEWER nas duas empresas e nos modos claro/escuro/mobile.

Aceite: nenhum dado da sessão anterior reaparece após novo login; nenhuma ação de A é enviada com sessão de B por estado obsoleto. Dependência: P3–P5.

### P7 — Provisionamento e ciclo de vida
- [x] Implementar operação interna transacional de criar empresa, administrador inicial e configurações padrão.
- [x] Implementar entrada de credenciais por stdin e documentar fornecimento operacional seguro, sem senha literal no histórico/log; entrega a administrador real ocorrerá em P9.
- [x] Tornar provisionamento idempotente por identificador explícito, rejeitando conflitos sem associar dados automaticamente.
- [x] Implementar suspensão/reativação, revogação de sessões e auditoria operacional.
- [x] Substituir bootstrap global baseado na existência de qualquer usuário por provisionamento explícito.
- [x] Manter cadastro de empresas fora das rotas acessíveis aos ADMIN dos clientes.

Aceite: provisionar B não altera A; execução repetida não duplica dados; empresa suspensa não autentica nem usa sessões antigas. Dependência: P3–P5.

### P8 — Homologação de isolamento
- [x] Executar a matriz da seção 9 em SQLite e PostgreSQL, respeitando a diferença de garantias.
- [x] Executar testes RLS e de pool em PostgreSQL real com papel de runtime restrito.
- [x] Inspecionar consultas/planos das listagens, dashboard e relatórios usando índices por empresa.
- [x] Revisar todas as importações diretas de banco e exceções privilegiadas; documentar lista permitida.
- [x] Reproduzir migração e restauração em cópia descartável de dados legados.

Aceite: todos os testes negativos de isolamento aprovados, sem bypass não explicado. Dependência: P1–P7.

### P9 — Publicação e operação
- [x] Preparar artefato completo e procedimento de corte; validar backup/restauração em ensaio descartável.
- [ ] Validar backup e homologação do ambiente real de publicação antes do corte.
- [ ] Usar janela de manutenção para o primeiro corte; drenar requisições e parar instâncias antigas.
- [ ] Executar migração com credencial própria, validar invariantes, publicar backend/frontend compatíveis e revogar sessões antigas.
- [ ] Validar smoke tests isolados por empresa antes de abrir o tráfego e antes de cadastrar a segunda empresa real.
- [x] Implementar logs por request/empresa/status/latência e documentar restauração, suspensão e resposta a incidentes.
- [ ] Configurar monitoramento no destino e acordar RPO, RTO e retenção antes de dados reais.

Aceite: release identificada, smoke tests aprovados e operação documentada. Publicação exige ambiente/credenciais disponíveis e autorização operacional; falta disso deve ser registrada como pendência, sem declarar a entrega publicada. Dependência: P8.

## 8. Migração dos dados e retorno seguro

1. Tirar backup e provar restauração em banco isolado antes do corte. Identificar quantidade de linhas por tabela e relações órfãs.
2. Escolher explicitamente a empresa inicial para todos os dados legados. Se já houver mistura de organizações, exigir mapeamento revisado; não inferir empresa pelo nome de setor, e-mail ou CPF.
3. Criar a empresa e adicionar colunas temporariamente preenchíveis; atribuir empresa aos pais e derivar a dos filhos pelas relações. Para configurações e avisos globais legados, atribuir à empresa inicial.
4. Validar que leitura de notificação e vínculos usuário/setor concordam com a empresa dos respectivos pais. Auditorias históricas sem referência ainda recebem a empresa inicial definida.
5. Detectar colisões de normalização e resolver por regra documentada, sem mesclar pessoas silenciosamente.
6. Adicionar obrigatoriedade, referências compostas, índices e unicidades locais. Eliminar unicidades globais incompatíveis e atualizar os upserts no código.
7. Revogar sessões antigas e iniciar a nova versão exigindo código de empresa no login.
8. Ativar e validar RLS com o papel real do runtime antes de liberar tráfego. Não usar a aplicação antiga no schema multiempresa.

No PostgreSQL, coordenar migrações concorrentes com o bloqueio de migração já existente. No SQLite, reconstruir tabelas quando necessário para alterar constraints, validar foreign keys e preservar IDs/sequências. Migração deve ser reexecutável ou reconhecer sua versão aplicada; falha não pode ser tratada como sucesso.

Retorno antes de novas escritas: manter manutenção e restaurar o backup/schema junto do artefato compatível. Depois de novas escritas, restaurar backup perde dados posteriores; preferir correção para frente ou procedimento de recuperação explícito. Depois que existir uma segunda empresa, é proibido voltar a servir tráfego com versão sem isolamento. Uma reversão nunca pode reunir dados de empresas distintas sob a empresa inicial.

## 9. Matriz mínima de testes obrigatórios

Criar empresas A e B com os mesmos nomes de setor, mesmo e-mail e mesmo CPF, mas registros, credenciais e configurações independentes. Criar ADMIN, MANAGER e VIEWER em cada uma, incluindo usuário sem setor. C mantém estado suspenso. Usar somente dados fictícios.

| Cenário | Resultado obrigatório |
| --- | --- |
| Login com empresa/e-mail/senha corretos | Sessão da empresa correta |
| Empresa inexistente, suspensa ou senha de outra empresa | Falha genérica, sem revelar vínculos |
| Token de A com company_id de B no corpo, query ou header | Rejeição ou parâmetro sem autoridade; nunca acesso a B |
| ADMIN de A consulta/edita/exclui recurso de B por ID conhecido | 404 e nenhum efeito |
| MANAGER tenta acessar setor não autorizado da própria empresa | Bloqueio conforme contrato de setor |
| VIEWER tenta mutações, inclusive leitura indevida de entidades externas | Permissões atuais preservadas; sem vazamento |
| Colaborador A vinculado a setor B; folga A com colaborador B | Aplicação e constraint recusam |
| Concessão de setor B a usuário A | Recusada, sem vínculos parciais |
| Mesmo e-mail, CPF e nome de setor em A/B | Permitido; repetição dentro da mesma empresa bloqueada |
| Dashboard, busca, detalhe, relatórios e CSV | Apenas dados e totais locais, mesmo sem filtro de setor |
| Feriado na mesma data em A/B | Calendário comum; cobertura, avisos e leitura independentes |
| Leitura individual/em lote de notificações | Apenas usuário, empresa e setores autorizados |
| Histórico e exclusão de entidade | Auditoria mantém empresa e snapshots; sem promoção de registro para global |
| Lote/recorrência com um ID externo | Nenhuma gravação nem auditoria parcial |
| Falha de auditoria durante mutação | Rollback do negócio |
| Configurações de DSR e nome diferentes | Nenhuma interferência entre empresas |
| Duas desativações concorrentes dos últimos administradores | Pelo menos um ADMIN ativo permanece |
| Suspensão durante uso e reativação | Requisições posteriores negadas; sessões antigas não recuperam acesso |
| SQL sem filtro explícito sob contexto A | RLS impede leitura/escrita em B |
| Conexão sem contexto ou com contexto inválido | Sem dados; escrita recusada |
| Pool com uma conexão, alternando A/B e provocando rollback/timeout | Nenhum contexto herdado; repetir também com requisições concorrentes |
| Papel de runtime tenta DDL, TRUNCATE ou bypass | Negado |
| Resolução privilegiada de autenticação | Sem enumeração/listagem livre e sem acesso a tabelas de RH |
| Logout A/login B, resposta atrasada de A e duas abas | Tela e ações usam somente sessão atual validada |
| Banco legado migrado e banco criado do zero | Mesmas constraints, políticas e comportamento |
| Provisionamento repetido e migração concorrente | Sem duplicação nem associação acidental |
| Restauração de backup global e recuperação isolada de empresa | Dados completos; nenhuma exposição a clientes de outras empresas |

Testar GET, POST, PUT e DELETE existentes; incluir rotas por ID e todos os endpoints listados em `server/routes`. Comparar respostas de ID inexistente e de ID externo. Não confiar em IDs imprevisíveis como controle de acesso. Testes de erro devem conferir também ausência de nomes/CPFs/conteúdo de outras empresas.

## 10. Operação, desempenho e recuperação

- Logs de requisição incluem identificador interno da empresa, usuário, request ID e resultado de autorização; não incluem token, senha, CPF ou conteúdo completo de relatórios.
- Monitorar erros, latência, volume e falhas de autorização por empresa. Não disponibilizar essas métricas globais aos clientes.
- Limitar tamanho de lotes, intervalo de relatórios e paginação; uma empresa não deve esgotar recursos comuns com consultas ilimitadas. Definir limites a partir de medição, sem inventar capacidade garantida.
- Backup global é ferramenta da plataforma e precisa incluir todas as empresas. Executá-lo com papel operacional adequado e validar contagens/restore; um backup filtrado acidentalmente por RLS é inválido.
- Recuperação de uma empresa começa restaurando o backup em ambiente isolado, extraindo o conjunto consistente daquela empresa e reconciliando dependências antes de reimportar. Nunca entregar um dump global a um cliente.
- Definir RPO, RTO e retenção antes da operação com dados reais; esses números ainda não foram fornecidos. Documentar o acordo operacional e o teste de recuperação.
- Eventuais arquivos, caches distribuídos e jobs futuros precisam incluir empresa nos namespaces e verificar autorização antes de servir objetos. Não há autorização para criar esses subsistemas nesta entrega.

## 11. Mapa de arquivos para o executor

| Área | Arquivos existentes principais |
| --- | --- |
| Banco, SQL e migração | `server/db/connection.ts`, `sql.ts`, `migrate.ts`, `migrate-sqlite.ts`, `postgres-schema.ts` |
| Inicialização/provisionamento | `server/index.ts`, `server/db/bootstrap.ts`, `seed.ts`, `reset.ts`, `scripts/start.mjs`, `render.yaml` |
| Autenticação/autorização | `server/routes/auth.ts`, `server/middlewares/auth.ts`, `server/utils/auth.ts` |
| Rotas de negócio | Todos os arquivos em `server/routes`, incluindo `users`, `departments`, `settings`, `audit`, `reports` e `holidays` |
| Regras e gravações | `server/services/dsrRules.ts`, `daysOff.ts`, `notifications.ts`, `holidays.ts` |
| Datas e calendário público | `shared/holidays.ts`, `dates.ts`, `schedule.ts`, `recurrence.ts` — manter cálculos puros independentes da empresa quando não usam dados privados |
| Sessão/interface | `src/context/AuthContext.tsx`, `src/services/api.ts`, `src/types/index.ts`, `src/App.tsx`, `src/pages/LoginPage.tsx` |
| Administração e identificação | `src/pages/UsersAdminPage.tsx`, `DepartmentsAdminPage.tsx`, `SettingsPage.tsx`, componentes de layout e CommandPalette |
| Testes | `scripts/run-isolated-tests.mjs`, `scripts/test-auth.ts`, `test-regression.ts`, `test-production.ts`, `test-holidays.ts` e demais suítes existentes |
| Documentação operacional | `docs/deploy-render-neon.md`, `docs/arquitetura-atual.md`, `README.md`, `.env.example`, `scripts/backup.ts` |

Criar módulos novos apenas quando delimitarem responsabilidades: resolução de empresa/sessão, unidade de trabalho, persistência com escopo, provisionamento e testes de isolamento. Nomes finais ficam a critério do executor; as regras deste documento não.

## 12. Instruções de entrega para outro modelo de IA

1. Leia este documento inteiro e valide as premissas contra o código antes de editar.
2. Trabalhe em P0 a P9, respeitando dependências. Não publique etapas intermediárias com isolamento parcial.
3. Atualize este documento por etapa: checkbox, evidência de teste, decisões e pendências.
4. Não use reset/seed nos dados atuais. Execute testes em bancos descartáveis; migração precisa de ensaio e backup.
5. Não considere um filtro no frontend, um helper de rota ou RLS isoladamente suficientes. Revise aplicação, banco, relações, sessão e UI.
6. Não amplie para cobrança, SSO, microsserviços ou identidade compartilhada sem mudança explícita de escopo.
7. Se uma decisão bloquear trabalho dependente, registre o ponto exato e avance nas tarefas independentes; não invente associação de dados ou credenciais.
8. Ao entregar, apresente arquivos alterados, testes e seus resultados, migrações, procedimento de execução, limitações e estado real da publicação.

Definição de concluído: duas empresas independentes podem ser provisionadas e operar todos os fluxos atuais; nem ADMIN atravessa a fronteira; banco recusa vínculos cruzados; migração preserva dados; testes negativos passam no PostgreSQL com papel restrito; estado visual não mistura sessões; operação e recuperação estão documentadas. P9 só pode ser concluída após publicação efetivamente verificada.

## 13. Situação deste planejamento

- [x] Inspeção do código, banco, autenticação, serviços e frontend.
- [x] Escolha de arquitetura e explicitação das premissas.
- [x] Definição do modelo de dados, migração, testes e critérios de aceite.
- [x] Roteiro preparado para execução por outro modelo.
- [x] P0: inventário, baseline e decisões iniciais.
- [x] Implementação e integração P1–P7 verificadas localmente, sem alterar o banco atual.
- [x] P8: matriz local, PostgreSQL real com runtime restrito, pools 1/3, concorrência, timeout e dump/restore.
- [ ] Corte operacional de P1/P9 e publicação completa no ambiente de destino.

Backend, frontend, comandos de migração/provisionamento e ferramenta compilada implementados. SQLite, PGlite, PostgreSQL real local (11.3), runtime por login restrito, pools 1/3, rollback/timeout, concorrência de agenda/ADMIN, migração simultânea, dump/restore legado e multiempresa, sessão/CSV atrasados e duas abas verificados. Navegador conferiu ADMIN/MANAGER/VIEWER em demo/Beta, nome canônico e temas/mobile. Ensaios locais não substituem homologação no PostgreSQL suportado/pool do destino. O banco atual continua legado, sem migração; startup novo exige corte explícito. P9 só será marcada após execução e validação do ambiente escolhido. Consulte multiempresa-operacao.md e multiempresa-execucao.md para evidências e comandos.
