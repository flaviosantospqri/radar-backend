# RADAR Backend

REST API do RADAR, separada do repositório mobile. O backend mantém regras de negócio, autenticação, pesquisa, cálculos e persistência no Neon PostgreSQL.

## Requisitos

- Node.js 22 ou superior
- Neon PostgreSQL
- Chave Gemini API para identificação visual
- Token OAuth do Mercado Livre opcional, conforme exigência da conta/API

O backend **não depende de armazenamento externo de imagens**. O upload é processado em arquivo temporário local, removido ao final da identificação. Somente os dados estruturados ficam no PostgreSQL.

## Configuração

```powershell
npm install
Copy-Item .env.example .env
```

Preencha `DATABASE_URL`, `JWT_SECRET` e `GEMINI_API_KEY`. `GEMINI_MODEL` tem valor inicial `gemini-3.8-flash`. `MERCADOLIVRE_ACCESS_TOKEN` é opcional e pode ser necessário conforme as permissões vigentes da API.

Não configure bucket, Firebase Storage ou qualquer chave de armazenamento de imagens.

## Executar

```powershell
npm run db:generate
npm run db:migrate
npm run dev
```

A API fica em `http://localhost:4000`; Swagger UI em `/api/docs`; verificação de saúde em `/health`.

## Upload e retenção de imagens

`POST /api/v1/analyses` e `POST /api/v1/analyses/:id/identify` recebem `multipart/form-data` com o campo `image`. JPEG, PNG e WebP são aceitos até 8 MB. Sharp verifica o conteúdo, normaliza a orientação e reduz a imagem para JPEG de até 1600 px. A imagem é gravada em um diretório temporário com prefixo `radar-analysis-`, enviada ao Gemini e removida em `finally`. Buffers são zerados ao término da requisição.

O processo remove temporários próprios com mais de `TEMP_IMAGE_MAX_AGE_MS` na inicialização e a cada 15 minutos. O padrão é uma hora. A imagem não é recuperável no histórico; para repetir uma identificação com falha, o cliente deve enviar a fotografia novamente para a rota de identificação.

## Scripts

- `npm run dev` — servidor com recarga
- `npm run build` — compilação
- `npm run typecheck` — verificação TypeScript
- `npm test` — testes automatizados
- `npm run db:generate` — gerar migration a partir do schema Drizzle
- `npm run db:migrate` — aplicar migrations ao Neon

Consulte [docs/architecture.md](docs/architecture.md) e [docs/api.md](docs/api.md) para fluxo e contratos.

