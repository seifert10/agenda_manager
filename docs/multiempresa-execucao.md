# Registro de execução multiempresa

## Baseline e decisões

- Usuário confirmou em 12/10/2026 que os dados atuais são mockados.
- Ensaio usa Empresa de demonstração, código demo. Para corte, destino explícito obrigatório.
- Alterações preexistentes de feriados e documentos preservadas.
- Nenhuma migração, seed ou reset executado no banco atual. Todos os ensaios usam bancos descartáveis.
- P0 concluída. Os checkboxes em plano-multiempresa.md registram tarefas verificadas; implementação/integração e homologação local foram concluídas; corte e publicação P9 continuam pendentes do destino/ambiente.

## Inventário e matriz de autorização

| Recurso | Operações | Empresa | Perfil / setor |
| --- | --- | --- | --- |
| Sessão | login, logout, me | Conta e token vinculados a uma empresa | Empresa e usuário ativos |
| Usuários | listar, criar, editar, ativar | Sempre local | ADMIN local |
| Setores | listar, criar, editar, desativar | Sempre local | Listagem conforme escopo; escrita ADMIN |
| Colaboradores | lista/detalhe/CRUD | Sempre local | ADMIN local ou MANAGER no setor; VIEWER só leitura |
| Folgas | CRUD, lote, recorrência | Sempre local | Perfil e setor de todos os colaboradores |
| Escalas | listar, salvar, excluir | Sempre local | Perfil e setor |
| Configurações | ler, salvar | Sempre local | Escrita ADMIN; nome canônico em companies |
| Dashboard e relatórios | consultar, CSV | Sempre local | Perfil e setores autorizados |
| Auditoria | consultar e registrar | Sempre local e permanente | Leitura por escopo; gravação atômica |
| Notificações | consultar, ler uma/todas | Sempre local | Setores autorizados; leitura pessoal |
| Feriados | calendário, cobertura | Datas públicas; cobertura local | Empresa e setores no resumo |
| Provisionamento | criar, suspender, reativar | Operação explícita | Somente operador interno |

Inventário: todas as rotas de server/routes, serviços de domínio, middleware de autorização/auditoria, bootstrap, migrations, seed/reset, backup e testes. Frontend: AuthContext, cliente API, App, layout, CommandPalette e páginas guardam estado ligado à sessão.

## Checklist de componentes implementados e verificados

- [x] Schema alvo em SQLite/PostgreSQL: empresa obrigatória, unicidades locais, referências compostas, índices e políticas RLS, incluindo companies. Arquivo: server/db/company-schema.ts.
- [x] Importação de snapshot para destino vazio e migração versionada 3 por reconstrução transacional. Preservam IDs, normalizam dados, retiram settings.company_name e descartam sessões antigas. Arquivos: company-migration.ts e upgrade-company.ts.
- [x] Ensaio de colisão de normalização: erro restaura integralmente tabelas/dados legados, sem registrar versão 3. Reexecução idempotente; outro código de destino recusado.
- [x] Backup físico SQLite descartável: integrity_check, foreign_key_check e comparação do conteúdo de todas as tabelas; imagem legada permanece legível após migrar a origem de teste.
- [x] Bloqueio do runtime e seed legados sobre schema versão 3, antes de atender tráfego ou apagar registros. Arquivos: company-cutover-guard.ts, index.ts, seed.ts.
- [x] Contexto imutável por execução assíncrona e unidade de trabalho na mesma conexão; ausência de transação autenticada recusa os novos repositórios. Arquivos: companyContext.ts e connection.ts.
- [x] Dois resolvedores exatos de autenticação, com SECURITY DEFINER, search_path fixo, proprietário restrito e execução revogada de PUBLIC. Arquivos: company-auth-schema.ts e company-auth-store.ts.
- [x] Concessões mínimas e guard de runtime: sem propriedade, superusuário, BYPASSRLS, DDL/TRUNCATE ou acesso a platform_operations/schema_migrations. Arquivos: company-runtime-grants.ts e company-runtime-check.ts.
- [x] Login por empresa/e-mail, /me e logout; hash de token; contas iguais em empresas distintas; suspensão nega autenticação. Arquivos: companyAuth.ts e company-auth.ts.
- [x] Revalidação de sessão e credencial dentro da transação: revogação/troca de senha entre resolvedor e unidade de trabalho impede a operação.
- [x] Limites HTTP por IP e por empresa/e-mail normalizados; variar o código não contorna o limite global por IP.
- [x] Executor HTTP retorna a resposta depois do commit e transforma falhas de domínio em rollback. Campo de empresa no corpo/query não substitui a sessão. Arquivo: company-endpoint.ts.
- [x] Helpers exigem empresa antes de aplicar perfil/setor, inclusive ADMIN. Arquivo: companyAuthorization.ts.
- [x] APIs administrativas de usuários, setores e configurações: filtros explícitos, validação de cada setor, revogação por senha/perfil/setores, nome canônico em companies e unicidade local. Arquivos: companyAdministration.ts e company-administration.ts.
- [x] Último ADMIN: trava a empresa antes de editar, revalida o ator após adquirir o bloqueio e confere administradores restantes. Duas requisições de desativação não eliminam todos os administradores.
- [x] Auditoria atômica com empresa e usuário autenticados; falha na auditoria desfaz negócio e impede resposta de sucesso. Arquivo: company-audit.ts.
- [x] APIs de colaboradores: listagem, detalhe, cadastro, edição, exclusão; CPF por empresa, setor sem default fixo, validação de origem/destino, regras habituais preservadas. Arquivos: companyEmployees.ts e company-employees.ts.
- [x] Leituras do perfil, DSR, métricas e histórico do colaborador consultam somente empresa/colaborador autorizados. Cálculo puro existente reutilizado; serviços legados com consultas globais não participam do fluxo novo.
- [x] Exclusão do colaborador conserva empresa, setor, snapshots e entity_id na auditoria; limpa somente employee_id opcional. Folgas/escalas dependentes removidas por cascade local.
- [x] Folgas/escalas no contexto autenticado: CRUD, conflitos, filtro de datas/mês, lote atômico, repetição semanal/domingos ordinais/combinada, preservação de registros existentes e idempotência. Arquivos: companyScheduling.ts e company-scheduling.ts.
- [x] Bloqueio da linha do colaborador em mutações de agenda/cadastro e ordem crescente de IDs nos lotes. Revalidação após bloqueio em edição/exclusão evita usar folga ou escala removida por outra operação. Pool real local homologado; repetir no ambiente de publicação.
- [x] Lote com referência externa e lote com duplicidade depois da primeira escrita não deixam folgas nem auditorias parciais. Falha de auditoria na segunda data recorrente desfaz a primeira e a alteração de escala.
- [x] Cobertura de feriados, histórico geral e relatórios/CSV consultam empresa e setores no SQL; joins incluem empresa. CSV é enviado depois do commit. Arquivos: companyReporting.ts e company-reporting.ts.
- [x] Dashboard calcula equipe, pendências, grade semanal, próximas folgas e avisos somente no escopo local. Arquivos: companyDashboard.ts e company-dashboard.ts.
- [x] Avisos de descanso/feriados usam ON CONFLICT(company_id,source_key); seleção e leitura em lote ficam no SQL com empresa/setor e recibo por usuário. Arquivo: companyNotifications.ts.
- [x] Testes de avisos confirmam IDs distintos para o mesmo feriado em A/B, leitura pessoal, bloqueio de ID externo e recibos em lote somente para setores autorizados.
- [x] Configurações de alerta diferentes em A/B verificadas no cálculo DSR sem alterar permanentemente as fixtures.
- [x] Backend novo composto em server/company-app.ts: autenticação, administração, colaboradores, agenda, dashboard, relatórios, CSV, auditoria, feriados e avisos. Guard de runtime executado antes da criação do app; nenhum router legado participa. Jornadas HTTP testadas na composição completa, inclusive usuário sem setor. O startup atual usa exclusivamente essa composição e não migra/provisiona.

## Validação reproduzível

- npm run test:company: schema, contexto, migração, backup SQLite, autenticação, administração, colaboradores e limites HTTP.
- npm run test:company:postgres: mesmas jornadas em PostgreSQL embarcado (PGlite), com RLS e papel restrito para as APIs; backup físico PostgreSQL não é coberto.
- npm run test:company-scheduling: agenda, leituras agregadas, CSV, feriados e notificações com duas empresas; também incluída na suíte completa.
- npm test: regressões existentes em SQLite.
- npm run build: TypeScript, frontend e artefato do servidor.

As suítes novas são scripts/test-company-foundation.ts, test-company-migration.ts, test-company-auth.ts, test-company-administration.ts, test-company-ratelimit.ts e test-company-scheduling.ts. Verificam 404 idêntico para ID externo/inexistente, concessão externa sem gravação parcial, perfil/setor, CPF/e-mail iguais entre empresas, configurações independentes, revogação, exclusão com histórico, agenda/recorrências, leituras agregadas e falha de auditoria.

A foundation executa ambos os dialetos em memória. Os demais testes usam scripts/run-isolated-tests.mjs, que desabilita DATABASE_URL externa e cria diretório temporário. Nunca apontar a suíte ao banco atual.

Resultado desta rodada (12–13/10/2026):

- [x] npm test: regressões existentes aprovadas.
- [x] npm run test:company: todas as suítes novas aprovadas.
- [x] npm run test:company:postgres: suíte completa aprovada com RLS, incluindo agendamentos, composição do backend, dashboard, CSV, feriados e notificações.
- [x] npm run build: TypeScript, Vite e servidor aprovados após as alterações finais.
- [x] PostgreSQL real local com login de runtime, pools 1/3 e restauração de dump legado/multiempresa: aprovado; repetir no destino.

## Checklist final local

- [x] Agenda, lotes, recorrência, dashboard, relatórios/CSV, auditoria, avisos e cobertura de feriados no fluxo novo com escopo desde SQL.
- [x] Provisionamento interno transacional e idempotente; suspensão/reativação revogam sessões; registro operacional separado. Testes SQLite, PGlite e PostgreSQL real.
- [x] Separação de credenciais/processos. company:ops lê stdin, exige destino/relatório de restauração para corte e possui artefato compilado independente. O HTTP não recebe credencial operacional, não executa bootstrap/migrations e não tem endpoint de plataforma.
- [x] Interface com código de empresa, empresa ativa, nome canônico atualizado após salvar, usuário validado em memória, limpeza completa por revisão de sessão, cancelamento e descarte de JSON/CSV/401 antigos, storage/focus entre abas e bloqueio de edição durante revalidação.
- [x] Onboarding por empresa no backend; nenhum dado de RH persistido em cache global. Tema permanece preferência do dispositivo.
- [x] Revisão React: listeners/intervalos com cleanup, estado desmontado por sessão, campos de login rotulados e viewer sem ações de edição no dashboard. CommandPalette/notificações/seleções/modais/nav usam a mesma fronteira de sessão.
- [x] Navegador: ADMIN/MANAGER/VIEWER em demo e Beta; listagem/dash com 10 vs 1 colaboradores, gestor de cozinha com 3; nome canônico alterado refletido no cabeçalho; logout em uma aba limpa a outra, login Beta revalida ambas e volta ao dashboard. Tema claro/escuro e viewport mobile 390x844 conferidos. Sem erros/warnings no console observado.
- [x] PostgreSQL real 11.3 em cluster local dedicado, sem acessar instalação/bancos existentes: matriz de auth/admin/agenda/provisionamento, login de runtime restrito em processo separado, pools 1 e 3, 60 operações concorrentes por tamanho, ausência de contexto, rollback e timeout, mutação de empresa externa sem efeito, DDL/TRUNCATE/SET ROLE/resolvedor negados.
- [x] HTTP com pool 3: duas folgas simultâneas produzem uma criação e uma recusa; duas desativações cruzadas preservam um ADMIN ativo.
- [x] Dump/restore físico de legado com conteúdo de todas as tabelas conferido antes de dois comandos de corte simultâneos; lock da versão e da instalação de segurança evita duplicação. Backup/restore multiempresa e extração local de A também conferidos.
- [x] EXPLAIN/ANALYZE/BUFFERS: índice idx_company_employees utilizado; partes do dashboard usam Nested Loop, relatório Sort e auditoria Limit na fixture. Não são medições de capacidade; reavaliar com volume do destino.
- [x] Artefato production compilado testado com login PostgreSQL restrito: startup, frontend estático, health, login/listagem A/B e ID externo 404. Não exige tsx para runtime ou ferramenta operacional compilada.
- [x] Fronteira estática: check:company-boundary percorre 33 módulos do HTTP, recusa routers legados/migração/provisionamento e import direto de db fora da lista explícita. Cálculo DSR puro extraído para shared/employee-status.ts; nenhum serviço SQL legado participa do grafo HTTP novo.
- [x] Runbook, .env.example, Blueprint Render e README atualizados; procedimento de recuperação individual é operacional e exige reconciliação revisada, sem merge automático.
- [ ] Homologar PostgreSQL suportado e pool no destino, definir RPO/RTO/retenção e monitoramento, validar backup desse ambiente.
- [ ] Confirmar nome/código destino, janela, acesso operacional e serviço de publicação; migrar banco escolhido, publicar e aprovar smoke remoto. Pergunta enviada ao usuário; sem resposta, não inventar destino/credenciais.

## Lista permitida de acesso ao banco HTTP

server/index.ts (shutdown), server/company-app.ts (schema/privilégios/health), server/db/company-auth-store.ts (duas resoluções exatas e perfil local), company-audit.ts (auditoria transacional), company-runtime-check.ts (catálogo/guard), server/services/companyAdministration.ts, companyAuthorization.ts, companyEmployees.ts, companyScheduling.ts, companyReporting.ts, companyNotifications.ts e companyDashboard.ts. Acesso de negócio exige companyTransaction e contexto do ator; filtros explícitos/composite joins revisados. Operacionais upgrade-company/companyProvisioning/company-ops ficam fora do grafo HTTP. Nenhuma substituição textual de SQL adiciona empresa.

## Testes reproduzíveis e limites

npm run test:company; npm run test:company:postgres (PGlite); npm run test:company:real (cluster localhost dedicado, bancos company_test_*); npm run test:company-session; npm run test:company-ops; npm run check:company-boundary; npm test; npm run build. TEST_COMPILED_COMPANY_OPS=1 também valida a ferramenta compilada em SQLite/PostgreSQL real. O runner real recusa hosts externos e remove exclusivamente bancos/roles novos do ensaio. As conexões dos testes com SET ROLE usam pool de uma conexão; o teste de pool usa login próprio de runtime, impedindo herdar privilégios do proprietário.

Versões locais: Node 25.1.0 e PostgreSQL 11.3 já instalados. O artefato configura Node 24, e o ambiente publicado deve usar PostgreSQL suportado; repetir verificações nesse destino. PGlite complementa a matriz, não substitui pool/login reais. Nenhuma migração/seed/reset foi executada sobre data/folga_manager.db. A restauração e backup atuais de produção não foram executados porque ambiente não foi informado.

A ferramenta exige relatório de restauração; backupVerified do migrador continua uma pré-condição atestada, não uma prova automática do conteúdo do relatório. Os ensaios criaram relatórios somente depois de conferir restore efetivo. O schema atual não foi alterado: npm run dev/start recusará o banco legado até o corte autorizado com destino explícito. Banco vazio usa initialize/create; legado usa migrate com backup, sem apagar dados para contornar o guard.

A publicação não está concluída. Os checkboxes de execução operacional permanecem abertos e não serão marcados pelo fato de código/build/testes locais estarem prontos.
