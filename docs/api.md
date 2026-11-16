# Contrato da API (v1)

Base local: `http://localhost:4000/api/v1`. Respostas de sucesso usam `{ "data": ... }`; erros usam `{ "error": { "code", "message", "requestId" } }`. Endpoints privados exigem `Authorization: Bearer <token>`.

## Análises

- `POST /analyses/live-session` — autenticado; emite token efêmero Gemini Live limitado ao modelo `GEMINI_LIVE_MODEL` (padrão `gemini-3.8-live`), à modalidade AUDIO e à função estruturada não bloqueante de identificação. A chave Gemini permanente nunca é retornada. Uma sessão pode enviar vídeo em quadros JPEG até 1 fps por 30 segundos. O cliente conecta ao Gemini diretamente; imagens não são enviadas a esta API.
- `POST /analyses/live-result` — autenticado; recebe `{"identification": {...}}`, valida todos os campos da identificação com Zod e cria o registro estruturado. Hipóteses opcionais permanecem em `identification.attributes.suggestions` e não exigem migration. Aceita `Idempotency-Key` para evitar duplicações.
- `POST /analyses/:id/confirm-identification` — JSON corrigido/confirmado pelo usuário.
- `POST /analyses/:id/research` — inicia pesquisa após confirmação.
- `GET /analyses/:id/result` — identificação, referências, estimativas, liquidez, cenários e recomendação.
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

Falha do Gemini mantém o resultado não criado; a identificação pode ser repetida ao iniciar outra sessão de leitura. Falha da fonte de mercado deixa a análise parcial, mantendo os dados já gravados. As referências do Mercado Livre são anúncios ativos, não vendas comprovadas. A foto não pode ser reaberta no histórico.

