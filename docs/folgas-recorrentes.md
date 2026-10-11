# Repetição automática de folgas

Disponível em **Nova Folga** (cabeçalho, dashboard e planejamento) e no editor de folga do calendário.

1. Escolha o colaborador e a data inicial.
2. Selecione descanso semanal ou folga compensatória.
3. Ative **Repetir esta folga**.
4. Escolha repetir o dia da semana, selecionar os domingos do mês, ou combinar as duas opções.
5. Informe **Repetir até** e confira a lista de datas antes de salvar.

Exemplo: início em segunda-feira, 05/10/2026, repetição semanal e 1º/3º domingos até 31/10/2026 gera 05, 12, 18, 19 e 26 de outubro. O primeiro domingo de outubro precede o início e não entra na lista. O 5º domingo só é gerado quando existir naquele mês.

As marcações são gravadas antecipadamente no salvamento. O período padrão é de 90 dias, ajustável até um ano contado da data inicial. Não há rotina de renovação sem data final nem tarefa que dependa de a aplicação ficar aberta. Ao chegar ao fim do período, o gestor pode gerar o próximo período novamente.

As próximas folgas recebem status **planejada**. A data inicial mantém o status informado; folgas já existentes não mudam. Datas com folgas ou ajustes explícitos de escala são preservadas e informadas no resultado. A mesma geração pode ser enviada novamente sem duplicar folgas. Cada marcação pode ser editada ou excluída individualmente. Alterar uma folga não desloca automaticamente as demais, e desmarcar repetição no formulário não apaga as marcações já geradas.

A funcionalidade reutiliza as tabelas, permissões por setor e auditoria existentes. Geração e edição com repetição são transacionais: uma falha de validação ou auditoria desfaz a operação completa. Não houve alteração no schema do banco.

Validação: compilação e seis suítes aprovadas, com regressões de repetição semanal, domingos ordinais, mudança de mês, 5º domingo, combinação sem duplicidade, preservação de férias e escalas, reenvio, geração a partir de uma folga existente, rollback e bloqueio por perfil/setor. No navegador, a prévia de segunda-feira com 1º e 3º domingos foi conferida sem gravar folgas de teste no banco atual.
