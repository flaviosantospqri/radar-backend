# Contrato da API (v1)

Base local: `http://localhost:4000/api/v1`. Respostas de sucesso usam `{ "data": ... }`; erros usam `{ "error": { "code", "message", "requestId" } }`. Endpoints privados exigem `Authorization: Bearer <token>`.

## Análises

### Criar e identificar

`POST /analyses` — `multipart/form-data` autenticado. Campo obrigatório `image` (JPEG, PNG ou WebP; máximo de 8 MB); `askingPriceCents` opcional, em centavos inteiros. Enviar `Idempotency-Key` para evitar análises duplicadas.

A API valida e otimiza a imagem em arquivo temporário, consulta o Gemini, valida a resposta e descarta o arquivo antes de responder. O retorno contém análise e identificação estruturada; não contém foto nem URL de imagem.

### Repetir identificação

`POST /analyses/:id/identify` — mesmo formato multipart com o campo `image`. A imagem é necessária novamente porque nenhuma fotografia é persistida.

### Confirmar e pesquisar

- `POST /analyses/:id/confirm-identification` — JSON corrigido/confirmado pelo usuário.
- `POST /analyses/:id/research` — inicia pesquisa após confirmação.
- `GET /analyses/:id/result` — identificação, referências, estimativas, liquidez, cenários e recomendação.
- `POST /analyses/:id/recalculate` — recalcula custos sem chamar IA nem a pesquisa.
- `GET /analyses/:id/references` — anúncios armazenados, com fonte, URL e data de coleta.
- `GET /analyses?page=1&limit=20` — histórico paginado; não inclui imagens.
- `GET /analyses/:id` — detalhe da análise; não inclui imagem.
- `PATCH /analyses/:id` — atualiza simulação financeira.
- `DELETE /analyses/:id` — remove a análise e dados associados; não requer chamada de storage.

## Autenticação, oportunidades e configurações

- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET /opportunities`, `POST /analyses/:id/opportunity`, `PATCH /opportunities/:id`
- `POST /opportunities/:id/purchase`, `POST /opportunities/:id/sale`
- `GET /settings`, `PUT /settings`
- `GET /health`, `GET /api/docs`

## Estados e limitações

Falha Gemini deixa a análise em `failed` e não inventa identificação; a repetição requer novo upload. Falha da fonte de mercado deixa a análise `partial`, mantendo os dados já gravados. As referências do Mercado Livre são anúncios ativos, não vendas comprovadas. A foto não pode ser reaberta no histórico.

