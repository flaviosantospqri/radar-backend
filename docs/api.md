# Contrato da API (v1)

Base local: `http://localhost:4000/api/v1`. Respostas de sucesso usam `{ "data": ... }`; erros usam `{ "error": { "code", "message", "requestId" } }`. Endpoints privados exigem `Authorization: Bearer <token>`.

## Análises

- `POST /analyses/live-session` — autenticado; emite token efêmero Gemini Live limitado ao modelo `GEMINI_LIVE_MODEL` (padrão `gemini-3.8-live`), à modalidade AUDIO e à função estruturada não bloqueante de identificação. A chave Gemini permanente nunca é retornada. Uma sessão pode enviar vídeo em quadros JPEG até 1 fps por 30 segundos. O cliente conecta ao Gemini diretamente; imagens não são enviadas a esta API.
- `POST /analyses/live-result` — autenticado; recebe `{"identification": {...}}`, valida todos os campos da identificação com Zod e cria o registro estruturado. Hipóteses opcionais permanecem em `identification.attributes.suggestions` e não exigem migration. Aceita `Idempotency-Key` para evitar duplicações.
- `POST /analyses/:id/confirm-identification` — JSON corrigido pelo usuário (opcional antes da pesquisa).
- `POST /analyses/:id/research` — pesquisa anúncios usando a identificação atual mesmo sem confirmação. O corpo opcional `{"force":true}` ignora o cache e substitui as referências anteriores após a consulta.
- `GET /analyses/:id/result` — identificação, média e faixa de preços, referências, liquidez, cenários e recomendação. `market.priceBasis` informa se a faixa vem de anúncios compatíveis (`active_listings`) ou itens similares (`similar_listings`). Resultados antigos podem manter a base histórica `grounded_estimate`. Sem preço de compra, retorna o teto de compra recomendado; lucro líquido e ROI são calculados quando o usuário informa o preço pedido.
- `POST /analyses/:id/recalculate` — recalcula custos sem chamar IA nem pesquisa.
- `GET /analyses/:id/references` — anúncios armazenados, com fonte, URL e data de coleta.
- `GET /analyses?page=1&limit=20` — histórico paginado, sem imagens.
- `GET /analyses/:id` — detalhe da análise, sem imagem.
- `PATCH /analyses/:id` — atualiza simulação financeira.
- `DELETE /analyses/:id` — remove a análise e os dados associados.

A API não possui endpoint multipart para imagem. Os quadros da câmera e fotos escolhidas no app são enviados diretamente do aparelho para o Gemini Live por uma conexão efêmera.

## Autenticação, oportunidades e configurações

- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET /opportunities`, `POST /analyses/:id/opportunity`, `PATCH /opportunities/:id`
- `POST /opportunities/:id/purchase`, `POST /opportunities/:id/sale`
- `GET /settings`, `PUT /settings`
- `GET /health`, `GET /api/docs`

## Estados e limitações

Falha do Gemini na leitura mantém o resultado não criado; a identificação pode ser repetida ao iniciar outra sessão. A pesquisa de mercado raspa HTML público de buscadores e páginas de ofertas, sem API oficial do Mercado Livre ou chamada Gemini para buscar preço. Os valores são preços anunciados, não vendas confirmadas; itens similares são indicados como parciais. A foto não pode ser reaberta no histórico.

