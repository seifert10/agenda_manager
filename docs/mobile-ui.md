# Revisão da interface mobile

Revisão de 11/10/2026, após relato de conteúdo cortado no iPhone 11.

## Ajustes

- Cabeçalho compacto, títulos com largura flexível e ações secundárias adaptadas à largura disponível.
- Notificações posicionadas na tela por portal, com margens laterais e botão de fechar.
- Janelas por portal, altura limitada à área visível e conteúdo com rolagem interna.
- Cartões e área principal podem encolher sem expandir a página.
- Calendário mensal e tabelas têm rolagem horizontal dentro da própria área, com orientação no mobile.
- Histórico quebra registros longos e permite que ações ocupem mais de uma linha.
- Busca mostra ações completas no celular, permite fechamento por toque e limita a altura da lista.
- Campos mobile usam fonte de 16px para evitar zoom automático do Safari; avisos respeitam as margens da tela.
- Controles principais do cabeçalho e navegação mobile têm área de toque de pelo menos 44px.

## Verificação

- Build de produção: TypeScript e Vite aprovados.
- Navegador com área de 414 × 896: dashboard, funcionários, escala, planejamento, relatórios, histórico, dicas, usuários, setores e configurações sem transbordamento horizontal do documento.
- Área de 375 × 812: histórico e busca sem transbordamento.
- Área de 768 × 1024: cabeçalho mantém espaço para o título.
- Área de 896 × 414: janela de planejamento fica dentro da tela, com rolagem interna.
- Formulário de funcionário e notificações ficam dentro das margens em 414 × 896.
- Calendário mensal e semanal mantêm a rolagem dentro do calendário.
- Nenhum erro registrado no console durante a conferência.

Verificação realizada com dimensões simuladas no navegador. A conferência em Safari no aparelho físico ainda deve ser feita, especialmente com o teclado virtual aberto.
