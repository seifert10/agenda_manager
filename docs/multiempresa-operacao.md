# Operação multiempresa

O artefato inicia exclusivamente `server/company-app.ts`. O runtime não migra nem provisiona; schema legado ou papel PostgreSQL privilegiado impede a inicialização. `DATABASE_URL` do serviço contém somente o login restrito de runtime. O resolvedor de autenticação é um papel dedicado sem login, sem propriedade de tabelas, sem associação ao runtime e sem acesso a RH. A credencial operacional de migração/provisionamento fica fora do serviço HTTP, em sessão administrativa separada.

## Comandos internos

`npm run build` compila servidor e ferramenta operacional separados. `npm run company:ops` executa `dist-server/company-ops.mjs` (também funciona após remover dependências de desenvolvimento) e recebe um objeto JSON pelo stdin. Nunca coloque senha ou URL com senha nos argumentos, no histórico, no Git ou em `VITE_*`. Para SQLite local informe `DB_PATH` explicitamente. Para PostgreSQL configure `MIGRATION_DATABASE_URL` somente na sessão operacional; a ferramenta recusa reutilizar implicitamente a URL do runtime. O operador PostgreSQL precisa dos privilégios de DDL e acesso global necessários, com credencial separada e acesso controlado. Os dois papéis de runtime/resolvedor devem existir previamente e não podem ser superusuário, BYPASSRLS ou membros do proprietário.

| action | Campos de entrada |
| --- | --- |
| initialize | `code`, `name`, `runtimeRole`, `resolverRole` (papéis só no PostgreSQL); exige banco vazio, cria versão 3 sem dados legados |
| migrate | `code`, `name`, `backupReport`, `runtimeRole`, `resolverRole`; exige legado versionado e relatório de restauração |
| create | `operationKey`, `operator`, `code`, `name`, `adminName`, `email`, `password`; cria empresa, ADMIN e configurações na mesma transação |
| suspend | `operationKey`, `operator`, `code`; bloqueia empresa e revoga todas as sessões |
| reactivate | `operationKey`, `operator`, `code`; reativa com novo login obrigatório |

`operationKey` é um identificador explícito de 8–128 caracteres (letras, números, `_`, `-`), único globalmente. Repetir exatamente uma criação retorna os IDs existentes, sem criar outro administrador. Alterar os dados/credencial ou usar o mesmo código com outra operação recusa associação automática. Depois de mudar a senha pelo cliente, a repetição com senha inicial é recusada. Suspensão/reativação repetidas não revertem uma operação posterior. As operações são auditadas em `platform_operations`, inacessível ao runtime dos clientes. Não existe endpoint de plataforma para ADMIN.

Exemplo PowerShell de entrada de credencial, sem senha literal no histórico:

```powershell
$secret = Read-Host 'Senha inicial (12–128 caracteres)' -AsSecureString
$credential = [System.Net.NetworkCredential]::new('', $secret)
$operation = @{ action='create'; operationKey='create-minha-empresa-20261012'; operator='operador-responsavel'; code='minha-empresa'; name='Minha empresa'; adminName='Administrador'; email='admin@example.com'; password=$credential.Password }
$operation | ConvertTo-Json -Compress | npm run company:ops
$operation.password = $null
$credential = $null
```

Entregar a credencial ao administrador por canal seguro já adotado pela operação, fora de logs/e-mail automático deste projeto. O administrador pode alterá-la pelo painel de usuários. A senha existe em memória durante a execução e é persistida somente com scrypt e salt aleatório. Não armazenar o JSON com a senha em arquivo comum.

## Corte de banco legado

1. Confirmar ambiente, nome/código da empresa destino e operador. Os dados locais foram declarados mockados; os ensaios usam `demo`, sem autorizar um mapeamento silencioso em produção.
2. Identificar a release pelo commit/artefato e seu SHA-256. Executar build, suíte SQLite, PGlite e PostgreSQL real; homologar também a versão e o pool do destino antes de dados reais.
3. Abrir manutenção, interromper entrada de tráfego, drenar requisições e parar **todas** as instâncias antigas. Evitar escrita entre snapshot, contagem e corte.
4. Fazer backup com credencial operacional que veja todas as empresas, usando URL PostgreSQL direta via `PGSERVICE`/`PGPASSFILE`. `pg_dump --dbname=service=folgamanager --format=custom --file=global.dump`. Validar restauração **em outro banco isolado**, contagens de todas as tabelas, IDs, referências e configurações. SQLite: backup pela API `node:sqlite`, abrir a cópia e verificar integridade, foreign keys e conteúdo.
5. Registrar um relatório protegido de evidência: `{ "verified": true, "destinationCode": "demo", "restoredAt": "data UTC do ensaio", "backup": "identificação e hash do backup", "evidence": "contagens/referências verificadas e ambiente isolado" }`. A ferramenta exige esse relatório, mas não substitui a comprovação operacional de seu conteúdo.
6. Executar `migrate` com destino explícito e credencial própria. A reconstrução é transacional, conserva IDs, bloqueia colisões e registra versão 3; sessões legadas são descartadas. Política RLS/resolvedores/concessões são instalados em transação separada antes de liberar runtime. Se falhar, continuar em manutenção; o guard recusa backend incompleto. Reexecução reconhece o destino já migrado e a instalação de segurança existente.
7. Conferir linhas por empresa, constraints compostas, sequências, índices, RLS ENABLE/FORCE, funções SECURITY DEFINER, papéis e ausência de concessões indevidas. Subir o artefato backend/frontend compatível usando somente a URL de runtime. Remover variáveis `INITIAL_ADMIN_*` antigas e não conceder ao serviço a URL operacional.
8. Smoke tests: código/e-mail/senha, `/auth/me` com empresa correta, setores, colaborador/folga/escala, dashboard, CSV, notificações, feriados, audit, logout e login da outra empresa fictícia de homologação. ADMIN não acessa IDs externos; VIEWER não edita. Testar duas abas e respostas antigas, celular e temas. `/api/health` verifica conexão, sem dados de negócio.
9. Liberar tráfego somente após aceite. Registrar release, resultado, executor e horário. Provisionar segunda empresa real somente após esse gate.

Banco vazio: usar `initialize`, instalar segurança e executar `create` para cada empresa explicitamente. Não executar seed/reset legados em schema 3. Instalação legada com dados atuais precisa do caminho `migrate` e backup; não apagar o banco para resolver erro de inicialização.

## Recuperação e incidentes

Antes de novas escritas: permanecer em manutenção e restaurar o backup junto do artefato compatível. Após novas escritas, preferir correção para frente; restore global perde alterações posteriores e exige decisão operacional. Depois da segunda empresa, nunca servir schema misto com artefato legado. Validar isolamento antes de reabrir tráfego.

Recuperação de uma empresa: restaurar globalmente **em ambiente isolado da plataforma**, extrair `companies.id` e todos os registros com o mesmo `company_id`, conferir dependências/IDs e reconciliar registros criados após o backup antes de uma reimportação transacional revisada. Preservar dados de outras empresas e auditar a operação. Não há comando automático de merge/restauração individual nesta entrega; a reconciliação depende do incidente. Nunca fornecer dump global a um cliente.

Suspeita de acesso indevido: suspender a empresa afetada pela operação interna, preservar logs e backup, investigar request IDs, corrigir/revalidar fronteiras e só então reativar. Sessões antigas permanecem revogadas. `platform_operations` preserva operador e ação; auditoria dos clientes mantém empresa e snapshots após exclusões.

Logs HTTP são JSON com request ID, empresa/usuário internos quando autenticados, método, rota, status e duração; sem token, senha, CPF, query ou corpo. Agregar erro/latência/403/404 por empresa no monitoramento interno do destino; não expor métricas globais aos clientes. Os logs ajudam detecção e diagnóstico, não provam ausência de vazamento. Limites existentes: JSON 1 MB, lote 500, auditoria 500, login por IP/conta; medir dashboard/relatórios e dimensionar pool antes da operação comercial. Definir RPO, RTO e retenção com o responsável operacional antes de dados reais; não há números acordados nesta tarefa.

## Evidências e limites

`npm run test:company`, `npm run test:company:postgres` (PGlite), `npm run test:company:real` (cluster local descartável) e `npm run build`. O runner real só aceita localhost e cria/remove bancos `company_test_*`; não pode apontar para produção. A suíte real testou PostgreSQL 11.3 já instalado, incluindo login restrito separado, pools 1/3, timeout/rollback e dump/restore. Essa versão antiga não é recomendação de produção; repetir em PostgreSQL suportado no destino. Defina `COMPANY_TEST_POSTGRES_URL` para um cluster **local dedicado de testes**, e `COMPANY_TEST_PG_BIN` para os utilitários dessa versão.

O banco atual e a publicação não foram modificados. A preparação local não equivale a release publicada. Destino, credenciais operacionais, janela e aceite do ambiente são gates de P9.
