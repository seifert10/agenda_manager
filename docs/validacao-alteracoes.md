# Validação das alterações — 11/10/2026

As quatro etapas iniciadas na sessão anterior foram concluídas: isolamento dos bancos de teste e migrações versionadas; consistência das folgas e escopo de acesso; dias habituais por colaborador em 3x4, convocação de freelancers e notificações pessoais; navegação e calendário mensal, semanal e diário.

`npm run build` passou. `npm test` passou nas seis suítes: backend, API, relatórios CSV, jornada do gestor, autenticação e regressões. As regressões verificam datas inválidas, repetição das migrações, dias de trabalho 3x4, convocação de freelancer, aviso de sequência longa mesmo com folga futura, movimentação de folga, exclusão, rejeição de escala conflitante, reversão integral de lote inválido, rollback em falha de auditoria e leitura pessoal de notificações com restrição por setor.

Cada suíte usa um SQLite temporário próprio. O banco atual recebeu backup em `backups/folga-before-resume-20261011-022908.db` antes da inicialização da aplicação. Os registros anteriores de colaboradores, usuários, folgas e escalas foram preservados. Cópias antigas de folgas com observação `Folga agendada` são desconsideradas na leitura e permanecem no banco.

A aplicação foi iniciada em http://localhost:5173/ e a API em http://localhost:3001/api. Login e renderização do dashboard e das visões de calendário foram conferidos no navegador. As operações de escrita foram verificadas pelas suítes em bancos temporários.

O Node precisou de execução fora do sandbox para as suítes e o servidor porque a consulta do usuário do Windows falhava com `uv_os_get_passwd ENOMEM` no ambiente restrito.

Os alertas usam datas e dias planejados. O sistema não registra horários de entrada/saída nem comprova descanso realizado. A hospedagem de produção continua sem decisão.
