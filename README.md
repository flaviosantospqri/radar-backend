# RADAR Backend

API REST do RADAR em Fastify. Mantém autenticação, regras de negócio, pesquisa de mercado, cálculos e histórico no Neon PostgreSQL.

## Configuração

Requer Node.js 22 ou superior, Neon PostgreSQL e uma chave Gemini Developer API.

```powershell
npm install
Copy-Item .env.example .env
```

Configure `DATABASE_URL`, `JWT_SECRET` e `GEMINI_API_KEY`. `GEMINI_LIVE_MODEL` usa `gemini-3.1-flash-live-preview` por padrão. `MERCADOLIVRE_ACCESS_TOKEN` é opcional e depende das permissões vigentes da API.

Não configure Cloudflare R2, Firebase Storage nem outro bucket de imagens. O backend não recebe arquivos de imagem.

## Executar

```powershell
npm run db:migrate
npm run dev
```

A API fica em `http://localhost:4000`; Swagger UI em `/api/docs`; verificação de saúde em `/health`.

## Identificação visual e privacidade

O app autenticado solicita `POST /api/v1/analyses/live-session`. O backend usa `GEMINI_API_KEY` para emitir um token de sessão Gemini Live de uso único e curta duração. O app abre uma conexão WebSocket diretamente com o Gemini e envia quadros comprimidos da prévia da câmera. Os quadros não passam pelo Render, não chegam ao Neon e não são gravados pelo RADAR.

Depois da identificação, o app envia somente o JSON validado pelo usuário para `POST /api/v1/analyses/live-result`. O backend valida o contrato com Zod e persiste identificação e estado da análise. A confirmação, pesquisa de anúncios, rentabilidade, oportunidades e histórico permanecem no backend.

O Gemini recebe os quadros diretamente para inferência. O RADAR não cria cópia permanente, não salva Base64 nem cria arquivo temporário no servidor. No celular, cada JPEG de captura é reduzido em cache do app, enviado à sessão Gemini e apagado ao terminar o processamento do quadro.

## Scripts

- `npm run dev` — servidor com recarga
- `npm run build` — compilação
- `npm run typecheck` — verificação TypeScript
- `npm test` — testes automatizados
- `npm run db:generate` — gerar migration a partir do schema Drizzle
- `npm run db:migrate` — aplicar migrations ao Neon

O fluxo novo não exige migration. Consulte [docs/architecture.md](docs/architecture.md) e [docs/api.md](docs/api.md).

