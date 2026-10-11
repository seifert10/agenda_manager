# Deploy no Render com PostgreSQL no Neon

Preparação validada em 11/10/2026: build aprovado, seis baterias aprovadas com SQLite, seis com PostgreSQL embarcado, teste de produção aprovado e auditoria de produção sem vulnerabilidades conhecidas. A bateria PostgreSQL e o teste de produção também passaram com Node 24.21.0. O serviço ainda não foi publicado; falta configurar o repositório e as contas Render/Neon.

O frontend React e a API Express usam um único Web Service no Render. O servidor entrega o frontend compilado e atende `/api` no mesmo endereço HTTPS. O Neon armazena os dados, incluindo sessões, sem depender do disco do Render.

Os dados mockados do SQLite local não são enviados ao Neon. O banco de produção começa vazio, com um administrador e configurações iniciais. Não há seed ou reset no deploy.

## 1. Enviar o código ao GitHub

Crie um repositório privado e envie o conteúdo do projeto. Você também pode extrair `deploy-package.zip` e enviar seus arquivos. O `render.yaml` deve ficar na raiz, ao lado de `package.json` e `package-lock.json`.

Não envie `.env`, `node_modules`, `data`, `backups`, `dist` ou `dist-server`. O `.gitignore` já exclui esses itens. Envie `.env.example`, que contém somente o modelo.

Se usar Git localmente, na pasta do projeto:

```powershell
git init
git add .
git commit -m "Preparar deploy Render e Neon"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
git push -u origin main
```

Use seu usuário e repositório reais no endereço. Se o Git solicitar nome e e-mail para o commit, configure sua identidade antes de repetir o commit.

## 2. Criar o banco no Neon

1. Entre no [Neon Console](https://console.neon.tech/) e crie um projeto no plano Free.
2. Escolha uma região próxima da região do Web Service no Render, preferencialmente na mesma região AWS quando disponível.
3. Abra **Connect**, selecione o banco e habilite **Connection pooling**.
4. Copie a URL PostgreSQL inteira, mantendo as opções TLS, como `sslmode=require`. O host da conexão agrupada contém `-pooler`.
5. Guarde a URL para o campo `DATABASE_URL` no Render. Ela contém credenciais: não a coloque no código, no GitHub ou em variáveis `VITE_*`.

O driver usa até cinco conexões e mantém cada transação em uma conexão única. Para futuras cópias de segurança com `pg_dump`, use a URL direta, sem `-pooler`. Consulte [conexão Node.js no Neon](https://neon.com/docs/guides/node) e [pooling](https://neon.com/docs/connect/connection-pooling).

## 3. Criar o serviço no Render

1. Entre no [Render Dashboard](https://dashboard.render.com/).
2. Escolha **New → Blueprint**, conecte sua conta GitHub e selecione o repositório.
3. O Render lê `render.yaml` e propõe um Web Service chamado `folga-manager`, no plano Free.
4. Preencha as variáveis solicitadas:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | URL PostgreSQL agrupada copiada do Neon |
| `INITIAL_ADMIN_EMAIL` | Seu e-mail para o primeiro administrador |
| `INITIAL_ADMIN_PASSWORD` | Senha própria com pelo menos 12 caracteres |
| `INITIAL_ADMIN_NAME` | Nome do administrador; padrão `Administrador` |
| `NODE_ENV` | `production`, já definido no Blueprint |
| `TZ` | `America/Sao_Paulo`, já definido no Blueprint |

5. Aplique o Blueprint e acompanhe os logs até o serviço estar disponível.

O Render fornece `PORT`. O servidor escuta em `0.0.0.0` nessa porta. A versão Node.js é fixada na série 24 por `.node-version`.

Se criar um **Web Service** manualmente, use:

| Configuração | Valor |
|---|---|
| Runtime | Node |
| Plan | Free |
| Root Directory | Vazio, raiz do repositório |
| Build Command | `npm ci --include=dev && npm run build && npm prune --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

Adicione as mesmas variáveis da tabela anterior. Não configure disco persistente nem banco SQLite no Render.

O build gera `dist` e `dist-server`. O comando de início usa JavaScript compilado e dependências de produção. As migrações e a criação do administrador acontecem antes de o servidor receber tráfego, inclusive no plano Free, sem depender de shell remoto ou comando de pré-deploy.

## 4. Primeiro acesso

1. Abra a URL `https://NOME-DO-SERVICO.onrender.com` apresentada pelo Render.
2. Confira `/api/health`: deve responder `status: online`; ele verifica a conexão ao banco.
3. Entre com `INITIAL_ADMIN_EMAIL` e `INITIAL_ADMIN_PASSWORD`.
4. Configure a empresa, cadastre os setores, usuários e funcionários.
5. Faça um agendamento de folga, incluindo recorrência, e confira calendário, histórico e exportação CSV.
6. Confira pelo celular para validar o layout mobile no endereço de produção.

O administrador só é criado quando não há usuários. Alterar as variáveis iniciais depois não troca a senha de uma conta existente. Faça alterações de senha pelo painel administrativo. Depois de confirmar o acesso, você pode remover `INITIAL_ADMIN_PASSWORD` do ambiente; os próximos deploys preservam a conta existente.

## Atualizações e recuperação

Envie novos commits ao repositório e confira a configuração de deploy automático no Render. O início aplica apenas migrações ainda não executadas e preserva os dados existentes. As migrações PostgreSQL usam lock transacional para evitar execução simultânea entre instâncias.

Antes de mudanças no schema, faça backup do Neon ou use os recursos de branches e recuperação disponíveis no seu plano. `npm run db:backup` é exclusivo do SQLite local. Em PostgreSQL, use `pg_dump` com a conexão direta, preferencialmente definida em `PGSERVICE` ou `PGPASSFILE`, evitando credenciais no histórico do terminal. Exemplo com serviço já configurado:

```text
pg_dump --dbname=service=folgamanager --format=custom --file=folga-manager.dump
```

Se o deploy falhar:

- Erro `DATABASE_URL`: confira a variável e a URL inteira do Neon.
- Banco vazio e erro `INITIAL_ADMIN_EMAIL`: configure e-mail válido e senha com pelo menos 12 caracteres.
- Falha de build: confira Node 24, lockfile enviado e Build Command da tabela.
- Health check 503: confira disponibilidade do Neon e conexão; não recrie nem limpe o banco.

## Desenvolvimento e validação

Sem `DATABASE_URL`, `npm run dev` continua usando SQLite local. Para usar PostgreSQL no desenvolvimento, defina uma URL de banco de desenvolvimento em `.env`; não use o banco de produção para seeds e testes.

```text
npm ci
npm test
npm run test:postgres
npm run build
npm run test:production
npm audit --omit=dev
```

As baterias SQLite e PostgreSQL usam bancos descartáveis e isolados. `test:postgres` usa o motor PostgreSQL embarcado PGlite e valida schema, consultas e transações; não acessa o Neon. A verificação da rede, TLS e conexão real ao Neon acontece no primeiro deploy. `test:production` verifica bootstrap, preservação de dados, frontend compilado, autenticação, limite de login, health check e bloqueio de SQLite em produção.

As dependências de desenvolvimento têm avisos de auditoria que exigiriam atualizações maiores de ferramentas. Elas são removidas do servidor pelo `npm prune --omit=dev`; a auditoria das dependências de produção passou sem vulnerabilidades conhecidas nesta preparação.

## Limites do plano gratuito

O Render Free suspende o Web Service após 15 minutos sem tráfego; o primeiro acesso depois disso pode demorar para iniciar. O sistema de arquivos é efêmero, por isso o banco fica no Neon. Confira os limites atuais de horas, armazenamento e processamento dos dois planos antes de uso contínuo pela empresa: [Render Free](https://render.com/docs/free), [Neon Pricing](https://neon.com/pricing).

Configuração baseada na documentação oficial: [Render Web Services](https://render.com/docs/web-services), [Blueprint YAML](https://render.com/docs/blueprint-spec), [Node.js](https://render.com/docs/node-version) e [health checks](https://render.com/docs/health-checks).
