# Arquitetura do RADAR

## Repositórios e responsabilidades

`radar-mobile` contém a câmera e a experiência de identificação. `radar-back` fornece autenticação, emissão segura de sessões Gemini, validação dos dados estruturados, pesquisa de mercado, cálculo financeiro e histórico. O Neon PostgreSQL armazena somente dados de domínio e resultados estruturados.

## Fluxo de leitura ao vivo

1. O usuário concede acesso à câmera e inicia a leitura ao vivo.
2. O app solicita uma sessão ao endpoint autenticado `POST /api/v1/analyses/live-session` e mantém uma única conexão ao vivo durante a leitura (até 30 segundos).
3. O backend usa `GEMINI_API_KEY` para emitir um token Gemini Live de uso único, com prazo curto, e restringe a sessão ao modelo e à configuração de identificação do RADAR.
4. O app conecta diretamente ao WebSocket Gemini Live, mantém a prévia aberta e envia quadros JPEG comprimidos no máximo uma vez por segundo por `realtimeInput.video`. Como a API não inicia uma resposta apenas com quadros de vídeo, o cliente envia um pedido de identificação depois do primeiro quadro e a cada três quadros seguintes. A saída é configurada como AUDIO e a identificação retorna por chamada de função estruturada não bloqueante; o app consome os argumentos JSON sem reproduzir áudio.
5. O app exibe e mescla as atualizações do JSON enquanto o usuário enquadra o item. As imagens vão diretamente ao Gemini e não atravessam a API RADAR.
6. Quando a leitura termina, o app envia somente os campos estruturados para `POST /api/v1/analyses/live-result`.
7. O backend valida a identificação com Zod e persiste análise e produto no Neon.
8. A confirmação/refinamento da identificação é opcional. O usuário pode pesquisar com os campos reconhecidos imediatamente ou editá-los antes da consulta.
9. O backend pesquisa anúncios ativos do Mercado Livre, calcula a média, mediana e faixa de preços e estima revenda e preço máximo de compra. O preço pedido é opcional: sem ele, a API não inventa lucro líquido; quando informado, calcula lucro e ROI.

Gemini recebe os quadros para processá-los. Eles não são armazenados pelo RADAR, enviados ao Render ou persistidos no PostgreSQL. O app mantém a melhor resposta estruturada durante até 30 segundos; uma resposta de confiança baixa, mas útil, segue para confirmação como hipótese editável. Se nenhum quadro permitir reconhecer o tipo de item, a leitura termina com orientação para enquadrar novamente. Uma fotografia de galeria, se escolhida, segue a mesma conexão direta ao Gemini e nunca é enviada ao backend.

## Persistência e histórico

Neon PostgreSQL guarda usuários, sessões, análises sem imagem, identificação estruturada, referências de mercado, cálculos, oportunidades, configurações e logs. Não existe coluna, tabela, Base64, URL, caminho local ou chave de storage para imagem. O histórico pode ser consultado sem recuperar a imagem original.

Matching, cenários e recomendação são executados pelo backend. Valores monetários são centavos inteiros. Anúncios ativos representam preços anunciados, não vendas realizadas.

## Integrações

- **Gemini Live:** o backend mantém a chave e emite credenciais efêmeras limitadas; o app envia quadros diretamente ao provedor. O modelo `gemini-3.8-live` identifica o item e pode retornar hipóteses em `attributes.suggestions`; o modelo não estima preços.
- **Mercado Livre:** adaptador para busca de anúncios ativos, com timeout e retry limitado. Falha na pesquisa mantém a identificação.
- **Neon:** autenticação, histórico e dados estruturados do RADAR.
- **Storage de imagens:** inexistente; sem R2, Firebase Storage ou outro bucket.

## Segurança e limites

O endpoint de sessão exige autenticação e tem rate limit de dez emissões por minuto. O token vale cinco minutos, aceita uma sessão e deixa de abrir novas sessões após um minuto. O cliente não recebe a chave Gemini permanente. As rotas da API RADAR não aceitam upload de imagem; o endpoint de resultado valida o formato e os limites dos campos da identificação.

