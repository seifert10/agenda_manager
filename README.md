# Folga Manager

Deploy como projeto novo no Render Free com PostgreSQL no Neon Free: siga [o guia de publicação](docs/deploy-render-neon.md). O Blueprint está em `render.yaml`; variáveis de exemplo em `.env.example`. Inicialize o banco e provisione a empresa antes de iniciar o serviço.

Para preparar a entrega com Node 24: execute `npm ci --include=dev`, depois `npm run check:deploy`. Com as validações aprovadas, `npm run package:deploy` gera `deploy-package.zip` e `deploy-package.sha256` (PowerShell 7). O pacote contém as fontes para o build no Render, sem banco local, backups, `.env` ou `node_modules`. A validação local usa SQLite e PostgreSQL embarcado; a conexão e os papéis do Neon precisam ser conferidos no destino conforme o guia.

> **Controle inteligente de equipe, folgas e escalas para empresas brasileiras**  
> Interface moderna inspirada no ecossistema macOS, com foco em garantir que nenhum funcionário seja esquecido na programação do Descanso Semanal Remunerado (DSR).

---

## 📋 Sumário
- [Visão Geral e Diferencial](#visão-geral-e-diferencial)
- [Stack Tecnológica](#stack-tecnológica)
- [Base Legal Brasileira (CLT / DSR)](#base-legal-brasileira-clt--dsr)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Como Instalar e Executar](#como-instalar-e-executar)
- [Comandos de Banco de Dados (SQLite)](#comandos-de-banco-de-dados-sqlite)
- [Testes Automatizados de Qualidade](#testes-automatizados-de-qualidade)
- [Atalhos de Teclado](#atalhos-de-teclado)

---

## 🎯 Visão Geral e Diferencial

O **Folga Manager** atua como um assistente de gestão proativo. Em vez de um simples calendário passivo, o sistema calcula dinamicamente quem precisa de atenção imediata:

- 🔴 **Folga Pendente**: Colaboradores que estão há mais de 5 dias sem descanso semanal planejado ou em risco de ultrapassar os 6 dias consecutivos.
- 🟡 **Folga Próxima**: Descansos programados para os próximos 1 a 2 dias que exigem alinhamento de turno e cobertura operacional.
- 🟢 **Folga Definida**: Colaboradores com DSR devidamente programado dentro do ciclo regulamentar.
- ⚪ **Sem Escala**: Colaboradores em férias regulamentares ou afastamento médico.

### Card "Atenção do Gestor"
Posicionado no topo do Dashboard, informa em poucos segundos:
1. Quem está trabalhando hoje.
2. Quem está de folga hoje.
3. Quem ainda não possui folga definida na semana.
4. Botão de resolução rápida em um clique para agendar pendências.

---

## 💻 Stack Tecnológica

- **Frontend**: React 18, TypeScript, Tailwind CSS (Design Tokens macOS), Lucide Icons, Date-fns.
- **Backend**: Node.js 24, Express e TypeScript; `tsx` em desenvolvimento e JavaScript compilado em produção.
- **Banco de Dados**: PostgreSQL no Neon em produção; SQLite local (`data/folga_manager.db`) em desenvolvimento quando `DATABASE_URL` estiver vazia. Migrações versionadas e transações nos dois bancos.
- **Build Tool**: Vite com proxy reverso `/api` configurado.

---

## ⚖ Base Legal Brasileira (CLT / DSR)

O aplicativo incorpora conceitos da legislação trabalhista brasileira (CLT e Lei 605/1949):
- **DSR Semanal**: Descanso remunerado de 24 horas consecutivas a cada período de 7 dias.
- **Limite de 6 Dias Contínuos**: Alerta preventivo para evitar que a folga recaia no 7º dia (evitando pagamento em dobro conforme OJ 410 do TST).
- **Trabalho aos Domingos**: Monitoramento do revezamento para garantir folga periódica aos domingos.
- **Intervalo Interjornada**: Observância do intervalo mínimo de 11 horas consecutivas entre jornadas (Art. 66 CLT).

> **Aviso Importante**: Este sistema fornece apoio ao planejamento de escalas e não substitui orientação do RH, contador ou profissional jurídico. Regras podem variar conforme categoria profissional, convenção coletiva, acordo coletivo e contrato de trabalho.

---

## 📁 Estrutura do Projeto

```
webapp/
├── data/
│   └── folga_manager.db         # Banco SQLite persistente
├── server/
│   ├── app.ts                   # Configuração Express e middlewares
│   ├── index.ts                 # Servidor HTTP (porta 3001)
│   ├── db/
│   │   ├── connection.ts        # Conexão SQLite (node:sqlite) com Foreign Keys
│   │   ├── migrate.ts           # Schema das 6 tabelas e índices
│   │   ├── seed.ts              # 10 colaboradores fictícios e cenários reais
│   │   └── reset.ts             # Reinicialização rápida do banco
│   ├── routes/                  # Endpoints REST (employees, days-off, dashboard, etc.)
│   ├── services/
│   │   └── dsrRules.ts          # Motor de regras DSR, conflitos e status
│   └── utils/
│       └── cpf.ts               # Validação e formatação algorítmica de CPF
├── src/
│   ├── components/
│   │   ├── ui/                  # Button, Card, Badge, Modal, ConfirmDialog, etc.
│   │   ├── layout/              # Sidebar macOS, Header, Spotlight
│   │   ├── dashboard/           # AttentionCard, StatCards, WeekCalendarCard
│   │   ├── calendar/            # FolgaModal e seletores
│   │   ├── employees/           # EmployeeModal e EmployeeDetailDrawer
│   │   └── onboarding/          # OnboardingModal de primeiro acesso
│   ├── pages/                   # Telas completas (Dashboard, Escala, Planejamento, etc.)
│   ├── context/                 # ThemeContext (Dark Mode) e ToastContext
│   ├── services/api.ts          # Cliente tipado da API
│   ├── types/index.ts           # Definições TypeScript
│   └── index.css                # Estilos globais e glassmorphism macOS
├── scripts/
│   ├── test-api.ts              # Teste de integração dos endpoints principais
│   └── test-reports.ts          # Teste de exportação CSV com validação UTF-8 BOM
├── package.json
└── README.md
```

---

## 🚀 Como Instalar e Executar

### 1. Pré-requisitos
- Node.js série 24, conforme `package.json` e `.node-version`.
- Gerenciador de pacotes `npm`.

### 2. Instalação das Dependências
```bash
npm install
```

### 3. Preparar o banco multiempresa

Siga [operação multiempresa](docs/multiempresa-operacao.md). Use `npm run company:ops` com ação `initialize` em banco vazio ou `migrate` para legado com backup restaurado e destino explícito. Provisionamento de empresa e ADMIN é interno, por stdin; não há criação automática no startup. Use Node 24 conforme package.json.

### 4. Iniciar a aplicação

`npm run dev` inicia servidor e frontend. Login solicita código da empresa, e-mail e senha. Runtime sobre schema legado é recusado até o corte; não use reset para contornar essa proteção. Para um ensaio sem alterar o banco atual, execute `npm run build` e `npm run test:company-browser`, em http://127.0.0.1:3417.

---

## 🗄 Comandos de Banco de Dados (SQLite)

| Comando | Descrição |
| :--- | :--- |
| `npm run company:ops` | Migração/inicialização e provisionamento internos explícitos, veja o runbook |
| `npm run db:backup` | Backup físico SQLite; conferir restauração antes do corte |
| `npm run test:company` | Matriz multiempresa SQLite e sessão frontend |
| `npm run test:company:postgres` | Matriz no PostgreSQL embarcado com RLS |
| `npm run test:company:real` | Pool, runtime restrito e dump/restore em cluster local descartável |
| `npm run db:migrate`, `db:seed`, `db:reset` | Ferramentas legadas para fixtures; não usar em schema 3 |

---

## 🧪 Testes Automatizados de Qualidade

Para garantir a confiabilidade de ponta a ponta:

1. **Testes de Regras de Negócio e Persistência**:
   ```bash
   npm run test:backend
   ```
   Valida CRUD de colaboradores, impedimento de folga duplicada, cálculo de DSR e integridade referencial.

2. **Testes de Integração de API**:
   ```bash
   npm run test:api
   ```
   Inicia servidor de teste com timeout de segurança, valida rotas `/health`, `/dashboard`, `/employees` e persistência.

3. **Testes de Exportação de Relatórios (CSV)**:
   ```bash
   npm run test:reports
   ```
   Valida download dos 3 tipos de relatórios (Folgas, Pendências e Auditoria), cabeçalhos e inclusão do Byte Order Mark (UTF-8 BOM) para compatibilidade com Microsoft Excel.

4. **Validação do Build de Produção**:
   ```bash
   npm run build
   ```

---

## ⌨ Atalhos de Teclado

- <kbd>Ctrl</kbd> + <kbd>K</kbd> (ou <kbd>Cmd</kbd> + <kbd>K</kbd>): Abre a Command Palette (Spotlight macOS) para buscar colaboradores e disparar ações instantâneas.
- <kbd>ESC</kbd>: Fecha modais e painéis laterais.
