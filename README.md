# RADAR Backend

API REST do RADAR em Fastify. Mantém autenticação, regras de negócio, pesquisa de mercado, cálculos e histórico no Neon PostgreSQL.

## Configuração

Requer Node.js 22 ou superior, Neon PostgreSQL e uma chave Gemini Developer API.

```powershell
npm install
Copy-Item .env.example .env
```

Configure `DATABASE_URL`, `JWT_SECRET` e `GEMINI_API_KEY`. `GEMINI_LIVE_MODEL` usa `gemini-3.8-live` por padrão e `GEMINI_MARKET_MODEL` usa `gemini-3.8-flash` para pesquisa com grounding do Google Search. `MERCADOLIVRE_ACCESS_TOKEN` é opcional e depende das permissões vigentes da API.

Não configure Cloudflare R2, Firebase Storage nem outro bucket de imagens. O backend não recebe arquivos de imagem.

## Executar

```powershell
npm run db:migrate
npm run dev
```

A API fica em `http://localhost:4000`; Swagger UI em `/api/docs`; verificação de saúde em `/health`.

## Identificação visual e privacidade

O app autenticado solicita `POST /api/v1/analyses/live-session` uma vez por leitura. O backend usa `GEMINI_API_KEY` para emitir um token de sessão Gemini Live de uso único e curta duração. O app abre uma conexão WebSocket diretamente com o Gemini e envia quadros JPEG comprimidos em sequência, até um por segundo, enquanto a câmera está aberta. Como o fluxo de vídeo não inicia respostas sozinho, o app pede uma atualização JSON após o primeiro quadro e depois a cada três quadros. A sessão usa a modalidade AUDIO exigida pelo Gemini Live e chamada de função estruturada não bloqueante; o app consome os argumentos JSON sem reproduzir áudio. Os quadros não passam pelo Render, não chegam ao Neon e não são gravados pelo RADAR.

Depois da identificação, o app envia somente o JSON estruturado para `POST /api/v1/analyses/live-result`. A confirmação dos campos é opcional: `POST /api/v1/analyses/:id/research` primeiro consulta anúncios ativos do Mercado Livre. Se a API bloquear a busca ou não encontrar anúncios compatíveis, o backend usa `GEMINI_MARKET_MODEL` com Google Search grounding e valida que os links e preços retornados estão entre as fontes citadas pela busca. O RADAR calcula média/faixa dos anúncios identificados ou, quando não há preço de anúncio verificável, persiste uma faixa indicativa de baixa confiança com as fontes consultadas. A tela mostra o valor médio e calcula quanto pagar no máximo no cenário selecionado, considerando taxas, custos e metas configurados. O preço pedido é opcional; quando informado, o RADAR calcula lucro líquido e ROI. O backend valida a resposta e persiste identificação, fontes e cálculos estruturados.

O Gemini recebe os quadros diretamente para inferência. O RADAR não cria cópia permanente, não salva Base64 nem cria arquivo temporário no servidor. No celular, cada JPEG de captura é reduzido em cache do app, enviado à sessão Gemini e apagado após o envio do quadro.

## Scripts

- `npm run dev` — servidor com recarga
- `npm run build` — compilação
- `npm run typecheck` — verificação TypeScript
- `npm test` — testes automatizados
- `npm run db:generate` — gerar migration a partir do schema Drizzle
- `npm run db:migrate` — aplicar migrations ao Neon

O fluxo novo não exige migration. Consulte [docs/architecture.md](docs/architecture.md) e [docs/api.md](docs/api.md).

