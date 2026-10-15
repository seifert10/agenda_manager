# Publicação do zero: Render Free + Neon Free

Destino escolhido: um novo Web Service no Render Free e um novo projeto PostgreSQL no Neon Free. A publicação remota depende de conectar as contas, preparar o banco e enviar a versão atual ao repositório. Este guia não comprova que o serviço foi publicado.

O frontend React e a API Express usam um único Web Service no Render. O servidor entrega o frontend compilado e atende `/api` no mesmo endereço HTTPS. O Neon armazena os dados, incluindo sessões, sem depender do disco do Render.

Os dados mockados do SQLite local não são enviados ao Neon. O banco de produção começa vazio, com um administrador e configurações iniciais. Não há seed ou reset no deploy.

## Antes de começar

Tenha acesso às contas [GitHub](https://github.com), [Neon](https://console.neon.tech) e [Render](https://dashboard.render.com). No computador, use Node 24, npm, PowerShell 7 e o cliente `psql` do [PostgreSQL para Windows](https://www.postgresql.org/download/windows/). O `psql` é usado para definir a senha do banco sem escrevê-la no histórico. Se não for reconhecido, adicione a pasta `bin` da instalação PostgreSQL ao PATH.

Siga esta ordem: fontes no GitHub → projeto Neon → papéis e senha → inicialização/ADMIN → projeto e serviço Render → conferência. O procedimento destina-se a **um banco novo vazio**. Para aproveitar um banco com dados, siga [multiempresa-operacao.md](multiempresa-operacao.md), com backup e migração.

Reserve estes nomes (os exemplos podem ser substituídos):

| Item | Exemplo |
| --- | --- |
| Projeto no Neon | `folga-manager-producao` |
| Banco | `neondb` (pode manter o padrão) |
| Projeto no Render | `Folga Manager` |
| Ambiente no Render | `Production` |
| Serviço novo no Render | `folga-manager-producao` — nome disponível no workspace |
| Código da empresa no login | `minha-empresa` |

Há duas credenciais PostgreSQL distintas. A URL **direta do proprietário** serve para preparar o banco e fica apenas na sessão operacional local. A URL **pooled do folga_runtime** será a `DATABASE_URL` do Render. O login do administrador da aplicação é uma terceira credencial, criada na etapa 3.

## 1. Preparar as fontes e o GitHub

Use Node 24, conforme `.node-version`. Confira `node --version`: deve começar com `v24.`. A presença de `.node-version` não troca automaticamente o Node instalado no Windows. Se aparecer `v25.`, instale a série 24 pelo [site oficial do Node.js](https://nodejs.org/en/download), feche o terminal, abra outro e confira novamente. `where.exe node` mostra quais executáveis estão no PATH.

No **Prompt de Comando (CMD)**, você pode copiar esta linha inteira. Os separadores `&&` executam a próxima etapa apenas se a anterior tiver sucesso:

```bat
npm ci --include=dev && npm run check:deploy
```

Ou execute **um comando de cada vez**, pressionando Enter e aguardando a conclusão de cada um:

```sh
npm ci --include=dev
npm run check:deploy
```

`check:deploy` compila frontend/servidor, executa a matriz multiempresa em SQLite e PostgreSQL embarcado (PGlite) e testa a ferramenta operacional compilada. Ele não acessa o Neon nem substitui a conferência no destino. Para gerar o pacote de fontes e seu SHA-256 após a aprovação, execute `npm run package:deploy` no PowerShell 7. Confira o arquivo com `Get-FileHash ./deploy-package.zip -Algorithm SHA256` e compare com `deploy-package.sha256`.

Não junte os comandos sem espaços/separadores. Se aparecer `include="devnpm"`, eles foram colados como `--include=devnpm run...`: apenas o primeiro npm foi executado, e o build/testes ainda precisam rodar. A sintaxe `&&` acima funciona no CMD e PowerShell 7; os blocos administrativos da etapa 3 exigem PowerShell 7.

Se o npm relatar vulnerabilidades, consulte `npm audit` e `npm audit --omit=dev`. Não aplique `npm audit fix --force` automaticamente: ele pode trocar versões principais de Vite/Tailwind e exigir mudanças no projeto. Um relatório sem alertas de produção não elimina a necessidade de tratar os alertas das ferramentas de desenvolvimento.

O repositório de deploy é [seifert10/agenda_manager](https://github.com/seifert10/agenda_manager). No Render, conecte esse repositório e selecione a branch `main`. O pacote de fontes gerado por `scripts/package-deploy.ps1` também pode ser importado em outro repositório. O Render precisa das fontes, não apenas de `dist/`.

Se quiser também um repositório novo, crie um repositório privado no GitHub e envie as fontes da raiz do projeto (incluindo `package-lock.json`, `server/`, `shared/` e `render.yaml`). Ao usar o ZIP, extraia os arquivos antes de enviá-los; não envie apenas o ZIP. O guia não executa push nem substitui o remoto atual.

## 2. Criar o projeto Neon e os papéis

1. Entre no [console do Neon](https://console.neon.tech) e escolha **New project** ou **Create project**.
2. Use o nome `folga-manager-producao`, plano **Free**, uma versão PostgreSQL suportada e uma região próxima à que pretende usar no Render. Confirme a criação.
3. No projeto recém-criado, mantenha a branch inicial e o banco padrão `neondb`, caso sejam esses os nomes exibidos. Não selecione um projeto antigo.
4. Abra **Connect**, selecione a branch, o banco e o papel proprietário (geralmente `neondb_owner`). Desative **Connection pooling** para obter a URL **direta**. Guarde-a em gerenciador de senhas; ela será solicitada localmente na etapa 3.
5. Abra **SQL Editor** no mesmo projeto, branch e banco. Execute o SQL abaixo como proprietário.

No SQL Editor, conectado como proprietário ao banco novo, crie os dois papéis por SQL. Não use o botão de criação de papéis do painel para o usuário da aplicação: ele concede associação a `neon_superuser`.

```sql
CREATE ROLE folga_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE company_auth_resolver NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT company_auth_resolver TO CURRENT_USER;
```

A associação temporária permite ao proprietário transferir as funções de autenticação ao resolvedor. Não conceda associação do runtime ao resolvedor nem ao proprietário.

Defina uma senha exclusiva do runtime por uma sessão `psql` operacional com `\password folga_runtime`; o comando solicita a senha sem incluí-la no histórico. Configure a conexão dessa sessão por serviço PostgreSQL/arquivo protegido ou entrada segura, sem URL com senha na linha de comando. Os nomes acima devem ser novos no projeto; se já existirem, inspecione-os em vez de recriá-los ou reutilizá-los silenciosamente.

Para abrir essa sessão no PowerShell, substitua apenas host, banco e usuário pelos valores de **Connect**, sem `-pooler` no host:

```powershell
psql "host=SEU_HOST_DIRETO.neon.tech port=5432 dbname=neondb user=neondb_owner sslmode=require" -W
```

O primeiro pedido de senha é o do **proprietário**. Quando aparecer o prompt `neondb=>`, execute:

```text
\password folga_runtime
\q
```

Os dois pedidos de senha de `\password` são para a **nova senha do runtime**. Guarde-a para montar a conexão do Render.

## 3. Inicializar o banco e criar a primeira empresa

O Render Free não oferece shell administrativo nem jobs avulsos. Prepare o banco pelo computador do operador, antes de iniciar o serviço. Não configure migrações no build ou no startup.

Na raiz das fontes (`H:\webapp - Copia`, nesta cópia), após `npm run build`, abra o PowerShell 7. Edite código, nomes, e-mail e operador no exemplo antes de colá-lo. A URL será solicitada em campo oculto; cole a URL **direta do proprietário** da etapa 2.

Este bloco inicializa o banco **uma única vez**, depois cria a empresa e o ADMIN:

```powershell
$migrationSecret = Read-Host 'URL direta do proprietário Neon' -AsSecureString
$migrationCredential = [System.Net.NetworkCredential]::new('', $migrationSecret)
$env:MIGRATION_DATABASE_URL = $migrationCredential.Password
$operation = $null
try {
    @{ action='initialize'; code='minha-empresa'; name='Minha empresa'; runtimeRole='folga_runtime'; resolverRole='company_auth_resolver' } |
        ConvertTo-Json -Compress | npm run company:ops
    if ($LASTEXITCODE -ne 0) { throw 'Inicialização recusada.' }

    $adminSecret = Read-Host 'Senha inicial do ADMIN (12–128 caracteres)' -AsSecureString
    $adminCredential = [System.Net.NetworkCredential]::new('', $adminSecret)
    $operation = @{ action='create'; operationKey='create-minha-empresa-inicial'; operator='operador-responsavel'; code='minha-empresa'; name='Minha empresa'; adminName='Administrador'; email='admin@example.com'; password=$adminCredential.Password }
    $operation | ConvertTo-Json -Compress | npm run company:ops
    if ($LASTEXITCODE -ne 0) { throw 'Provisionamento recusado.' }
} finally {
    Remove-Item Env:MIGRATION_DATABASE_URL -ErrorAction SilentlyContinue
    if ($operation) { $operation.password = $null }
    $adminCredential = $null
    $migrationCredential = $null
    $adminSecret = $null
    $migrationSecret = $null
}
```

Troque código, nomes, e-mail e operador pelos dados reais antes de executar. O código faz parte do login. `initialize` exige banco vazio e não importa o SQLite local; banco com dados exige o procedimento de migração do runbook.

Resultado esperado: uma linha JSON com `schemaVersion: 3` e `securityInstalled: true`, seguida de outra com `companyId`, `adminId` e `repeated: false`. Mensagens do npm também aparecem e são normais. Se a criação do ADMIN falhar após inicializar, corrija a entrada e execute somente a ação `create` pelo procedimento de [operação multiempresa](multiempresa-operacao.md); não repita o bloco inteiro nem apague o banco.

Após inicialização bem-sucedida, na mesma identidade proprietária usada para conceder a associação temporária:

```sql
REVOKE company_auth_resolver FROM CURRENT_USER;
```

Copie a conexão **pooled** do Neon (host com `-pooler`) usando `folga_runtime` e a senha exclusiva dele, com `sslmode=require`. Se o papel SQL não aparecer no seletor, substitua usuário e senha na conexão pelo cliente seguro, codificando caracteres especiais da senha como componentes de URL. Nunca reutilize a conexão proprietária no Render.

Formato de referência, com valores fictícios:

```text
postgresql://folga_runtime:SENHA_CODIFICADA@SEU_HOST-pooler.REGIAO.aws.neon.tech/neondb?sslmode=require
```

Use o host exato fornecido pelo Neon; o formato do sufixo varia por região/provedor. Na senha da URL, caracteres como `@`, `:`, `/`, `#` e `%` precisam de percent-encoding. A senha do ADMIN não é a senha do banco.

## 4. Criar um projeto novo e o Web Service no Render

Para seguir o caminho manual pelo painel:

1. Entre no [Render](https://dashboard.render.com), no workspace desejado.
2. Clique em **New → Project**. Nomeie o projeto `Folga Manager` e o primeiro ambiente `Production`; confirme em **Create a project**.
3. Dentro do projeto, crie um serviço em **New → Web Service**. Conecte sua conta GitHub, autorizando o acesso ao repositório, e selecione as fontes da etapa 1.
4. Selecione a branch que contém a versão preparada. Se houver seletor de projeto/ambiente, use o projeto novo e `Production`.
5. Preencha a configuração abaixo. **Root Directory** fica vazio quando `package.json` está na raiz. Escolha a região próxima ao Neon e o tipo de instância **Free**.
6. Antes de iniciar o deploy, cadastre todas as variáveis da tabela em **Environment Variables**. A URL do banco deve ser inserida como valor protegido, nunca no código.
7. Clique em **Deploy Web Service** (ou no botão de criação equivalente). Acompanhe a aba **Events/Logs** até o serviço ficar **Live**.

Use **Web Service** porque esta aplicação contém uma API Node; não escolha **Static Site**.

| Campo | Valor |
| --- | --- |
| Nome | `folga-manager-producao` (ou outro nome disponível para o serviço novo) |
| Language / Runtime | `Node` |
| Instance Type | `Free` |
| Build command | `npm ci --include=dev && npm run build && npm prune --omit=dev` |
| Start command | `npm start` |
| Health check | `/api/health` |
| Node | série 24, pela `.node-version` |
| `NODE_ENV` | `production` |
| `TZ` | `America/Sao_Paulo` |
| `DB_POOL_MAX` | `5` |
| `DATABASE_URL` | URL pooled do **folga_runtime**, como segredo no Render |
| `COMPANY_AUTH_RESOLVER_ROLE` | `company_auth_resolver` |

O Render fornece `PORT`; o servidor já escuta em `0.0.0.0`. Se houver `NODE_VERSION` no painel, ele tem precedência sobre `.node-version`: remova-o ou configure série 24. Não cadastre `MIGRATION_DATABASE_URL`, `INITIAL_ADMIN_*`, credenciais do proprietário ou variáveis `VITE_*` com segredos. SQLite não é usado em produção.

Como alternativa à criação manual, use **New → Blueprint** com o `render.yaml` do repositório e informe `DATABASE_URL` e `COMPANY_AUTH_RESOLVER_ROLE` quando solicitado. Antes de sincronizar, confira se o nome definido no YAML é novo no workspace: um nome existente pode fazer o Blueprint alterar o serviço antigo. O YAML atual define o serviço, sem criar automaticamente um Project/Environment; associe o serviço ao projeto novo pelo painel. Escolha apenas um dos caminhos para evitar serviços duplicados.

## 5. Conferir a publicação e o primeiro login

Abra `https://SEU-SERVICO.onrender.com/api/health` e confirme HTTP 200 e `status: online`. Abra a raiz e faça login com código da empresa, e-mail e senha provisionados. Confira `/api/auth/me`, setores, colaborador, folga, escala, dashboard, CSV, notificações e logout. Uma rota `/api` inexistente deve retornar JSON 404, sem HTML do frontend. Confira isolamento com duas empresas de homologação antes de disponibilizar dados reais.

O endereço real aparece na página do serviço no Render. A tela de login deve receber **código da empresa**, **e-mail do ADMIN** e **senha do ADMIN**, todos definidos na etapa 3. A API `/api/auth/me` requer a sessão autenticada; verifique-a pelas requisições do navegador após entrar, sem publicar o token.

Se o startup recusar privilégios ou schema, corrija o banco/papéis pelo runbook; não desative a validação. O teste legado `test:production` não valida a composição multiempresa atual; use a matriz `test:company`, PostgreSQL real isolado e smoke tests no destino.

## Se ocorrer um erro

| Sintoma | O que conferir |
| --- | --- |
| Repositório não aparece no Render | Permissão da integração GitHub para o repositório e workspace corretos. |
| Build não encontra `package.json` | Root Directory e arquivos realmente enviados à branch selecionada. |
| Falha de Node/compilação | Node série 24, lockfile versionado e Build Command completo. |
| `DATABASE_URL` obrigatória | Variável cadastrada no serviço; não basta estar no computador local. |
| Falha de senha/conexão PostgreSQL | URL pooled, senha do runtime codificada, banco/branch corretos e `sslmode=require`. |
| Runtime exige papel sem privilégios administrativos | Foi usada a URL do proprietário ou papel criado pelo painel; use o papel SQL `folga_runtime`. |
| Schema incompleto/resolvedor inválido | Etapa 3 concluída, `securityInstalled: true` e `COMPANY_AUTH_RESOLVER_ROLE=company_auth_resolver`. |
| Login retorna credenciais inválidas | Empresa provisionada e ativa; código, e-mail e senha do ADMIN. Inicializar schema não cria ADMIN sozinho. |
| Serviço demora no primeiro acesso | Aguarde o despertar do plano Free; se persistir, consulte Events/Logs e `/api/health`. |

## Atualizações após a primeira publicação

Envie as alterações à branch conectada. Se o deploy automático estiver habilitado, o Render fará um novo build; caso contrário, use **Manual Deploy → Deploy latest commit**. A `DATABASE_URL` permanece no serviço e os dados permanecem no Neon. Não execute `initialize` novamente. Mudanças de schema devem seguir o runbook operacional com backup, fora do startup.

## Comportamento do plano Free

O Render Free suspende o serviço após 15 minutos sem tráfego; o primeiro acesso pode levar cerca de um minuto para acordá-lo. O disco é temporário, por isso todos os dados persistem no Neon. O Neon também pode suspender o compute ocioso. As cotas dos planos devem ser conferidas nos painéis antes de liberar uso; não há garantia de disponibilidade contínua no plano gratuito.

Referências: [projetos no Render](https://render.com/docs/projects), [Express no Render](https://render.com/docs/deploy-node-express-app), [Blueprint](https://render.com/docs/blueprint-spec), [Render Free](https://render.com/docs/free), [Node no Render](https://render.com/docs/node-version), [console do Neon](https://neon.com/docs/get-started/signing-up), [conexão no Neon](https://neon.com/docs/get-started/connect-neon), [papéis no Neon](https://neon.com/docs/manage/roles), [pooling no Neon](https://neon.com/docs/connect/connection-pooling). Para operação, backup e recuperação, siga [multiempresa-operacao.md](multiempresa-operacao.md).
