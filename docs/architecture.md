# Arquitetura do RADAR

## Repositórios e responsabilidades

`radar-mobile` contém a câmera e a experiência de identificação. `radar-back` fornece autenticação, emissão segura de sessões Gemini, validação dos dados estruturados, pesquisa de mercado, cálculo financeiro e histórico. O Neon PostgreSQL armazena somente dados de domínio e resultados estruturados.

## Fluxo de leitura ao vivo

1. O usuário concede acesso à câmera e inicia a leitura ao vivo.
2. O app mostra a prévia contínua da câmera e captura quadros JPEG pequenos, em sequência e no máximo uma vez por segundo.
3. O app solicita uma sessão ao endpoint autenticado `POST /api/v1/analyses/live-session`.
4. O backend usa `GEMINI_API_KEY` para emitir um token Gemini Live de uso único, com prazo curto, e restringe a sessão ao modelo e à configuração de identificação do RADAR.
5. O app conecta diretamente ao WebSocket Gemini Live e envia os quadros para inferência. O fluxo de bytes de imagem não atravessa a API RADAR.
6. O app interpreta a resposta JSON e envia somente os campos estruturados para `POST /api/v1/analyses/live-result`.
7. O backend valida a identificação com Zod e persiste análise e produto no Neon.
8. O usuário confirma/corrige a identificação; só então o backend pesquisa anúncios, estima preços e calcula rentabilidade.

Gemini recebe os quadros para processá-los. Eles não são armazenados pelo RADAR, enviados ao Render ou persistidos no PostgreSQL. Uma fotografia de galeria, se escolhida, segue a mesma conexão direta ao Gemini e nunca é enviada ao backend.

## Persistência e histórico

Neon PostgreSQL guarda usuários, sessões, análises sem imagem, identificação estruturada, referências de mercado, cálculos, oportunidades, configurações e logs. Não existe coluna, tabela, Base64, URL, caminho local ou chave de storage para imagem. O histórico pode ser consultado sem recuperar a imagem original.

Matching, cenários e recomendação são executados pelo backend. Valores monetários são centavos inteiros. Anúncios ativos representam preços anunciados, não vendas realizadas.

## Integrações

- **Gemini Live:** o backend mantém a chave e emite credenciais efêmeras limitadas; o app envia quadros diretamente ao provedor. O modelo só identifica o item e não estima preços.
- **Mercado Livre:** adaptador para busca de anúncios ativos, com timeout e retry limitado. Falha na pesquisa mantém a identificação.
- **Neon:** autenticação, histórico e dados estruturados do RADAR.
- **Storage de imagens:** inexistente; sem R2, Firebase Storage ou outro bucket.

## Segurança e limites

O endpoint de sessão exige autenticação e tem rate limit de dez emissões por minuto. O token vale cinco minutos, aceita uma sessão e deixa de abrir novas sessões após um minuto. O cliente não recebe a chave Gemini permanente. As rotas da API RADAR não aceitam upload de imagem; o endpoint de resultado valida o formato e os limites dos campos da identificação.

