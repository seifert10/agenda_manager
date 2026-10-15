# Implementação de feriados

## Escopo
Calendário anual calculado localmente, sem dependência de API externa. Nove feriados nacionais fixos; Sexta-feira da Paixão identificada como data religiosa de aplicação municipal; Carnaval e Corpus Christi identificados como pontos facultativos de referência federal. Sem criar folgas automaticamente. Feriados estaduais/municipais personalizados ficam como extensão futura.

## Checklist
- [x] 1. Módulo compartilhado: datas fixas/móveis, categorias, intervalos e hoje em America/Sao_Paulo.
- [x] 2. API autenticada: resumo do mês/semana/próximo e cobertura limitada aos setores autorizados.
- [x] 3. Notificações nacionais: janela de sete dias e aviso no dia, sem duplicação e com leitura por usuário.
- [x] 4. Interface: card no dashboard, navegação para a data e cabeçalhos lilás nas visões mensal/semanal/diária.
- [x] 5. Verificação: datas móveis, viradas de ano/mês, fuso, isolamento, leitura, build e revisão de componentes.

## Resultados da validação
- `npm test`: todas as suítes existentes e a nova suíte de feriados aprovadas em SQLite isolado.
- `npm run test:holidays` com `TEST_DATABASE=postgres`: aprovado em PostgreSQL embarcado, sem conexão externa.
- `npm run build`: TypeScript, frontend e servidor compilados.
- Navegador com banco em memória: dashboard do gestor Cozinha mostrou 2 trabalhando e 1 de folga em 12/10/2026; botão abriu essa semana; cabeçalhos mensal/semanal/diário exibiram o feriado; modo escuro conferido; aviso no sino confirmado; nenhum erro/aviso no console.
- Revisão React: consultas independentes em paralelo, estado tipado, limpeza do intervalo/eventos e identificação textual além da cor.
- Evidência visual: `docs/feriados-preview.png` (dados fictícios).
- Não há etapas pendentes no escopo implementado. Cadastro de feriados locais permanece uma extensão futura.

## Critérios
- Feriado não substitui DSR, jornada ou folga registrada.
- Pontos facultativos e datas locais usam texto explícito, sem alertas nacionais automáticos.
- Notificações são geradas ao consultar o sistema; não há envio externo nem agendamento em segundo plano.
- Testes usam banco isolado, sem modificar dados reais.

## Fontes
- https://www.planalto.gov.br/ccivil_03/leis/2002/l10607.htm
- https://www.planalto.gov.br/ccivil_03/leis/l6802.htm
- https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14759.htm
- https://www.planalto.gov.br/ccivil_03/leis/l9093.htm

## Extensões futuras
- [ ] Cadastro administrativo de feriados locais e pontos facultativos adotados pela empresa, com localidade e fonte legal.
