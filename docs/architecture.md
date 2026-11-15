# Arquitetura do RADAR Backend

## Repositórios e responsabilidades

`radar-back` é um repositório Git independente. O mobile conversa exclusivamente com a API Fastify versionada em `/api/v1`. O backend é a fonte das regras, persiste dados estruturados no Neon por Drizzle ORM e integra o Gemini e provedores autorizados de pesquisa.

## Ciclo de vida da imagem

1. O cliente envia uma única fotografia por `multipart/form-data`.
2. Fastify limita o upload a 8 MB e aceita somente `image/jpeg`, `image/png` ou `image/webp`.
3. Sharp decodifica o conteúdo; não se confia somente no MIME declarado. A imagem é orientada, redimensionada para caber em 1600 × 1600 px e convertida em JPEG.
4. O arquivo otimizado existe temporariamente em uma pasta própria do sistema (`radar-analysis-*`). O backend o lê para a chamada multimodal do Gemini.
5. O backend valida a saída estruturada com Zod e grava os campos da identificação em `products`, além dos logs de uso.
6. Em sucesso ou falha, o `finally` zera os buffers e remove a pasta e o arquivo temporários.

Não há Cloudflare R2, Firebase Storage, URL assinada, caminho de imagem persistido, nem Base64 de imagem no PostgreSQL. O Base64 exigido pela API multimodal pode existir transitoriamente na chamada ao provedor; não é salvo no banco.

O serviço também remove, na inicialização e a cada 15 minutos, somente pastas `radar-analysis-*` com idade superior a `TEMP_IMAGE_MAX_AGE_MS` (padrão: 1 hora), cobrindo encerramentos abruptos. Se a identificação falhar, o histórico conserva análise e erro; uma nova tentativa exige que o cliente reenvie a fotografia.

## Persistência

Neon PostgreSQL guarda usuários, sessões, análises sem arquivo de imagem, identificação estruturada, referências de mercado, cálculos, oportunidades, configurações e logs. Excluir uma análise remove seus registros dependentes por integridade referencial. O histórico continua disponível sem a foto original.

Todos os valores monetários são centavos inteiros. Matching, cenários e recomendação são executados pelo backend. Anúncios ativos são tratados como preços anunciados, não vendas realizadas.

## Integrações

- **Gemini:** SDK oficial `@google/genai`, chave mantida somente no backend; modelo selecionado por `GEMINI_MODEL`. O modelo identifica a fotografia, nunca fornece preços.
- **Mercado Livre:** adaptador de API oficial de busca de anúncios ativos, com timeout e retry limitado. Falha na pesquisa mantém a identificação.
- **Imagens:** temporárias no disco local do processo; nenhum fornecedor ou credencial de armazenamento externo.

## Segurança e privacidade

Uploads autenticados, limite de tamanho e quantidade, allowlist de MIME, validação real por decodificação, caminhos temporários aleatórios, diretórios removidos após uso, endpoints isolados por usuário, segredos apenas no backend e logs sem conteúdo de imagem.

