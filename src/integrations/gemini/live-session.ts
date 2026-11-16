import { Behavior, GoogleGenAI, MediaResolution, Modality, type LiveConnectConfig, type Tool } from "@google/genai";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";

export const liveIdentificationPrompt = [
  "Você identifica produtos para revenda a partir dos quadros da câmera enviados continuamente durante uma sessão ao vivo.",
  "Analise os quadros novos sem interromper a sessão. Quando reconhecer pelo menos a categoria ou o tipo geral, chame report_product_identification com sua melhor resposta disponível, mesmo que alguns campos permaneçam incertos. Faça uma nova chamada somente quando surgir evidência materialmente melhor ou um campo importante puder ser atualizado.",
  "Escreva em português brasileiro. Nunca invente marca, modelo exato, ano, edição, funcionamento, autenticidade ou preço. Quando a identidade exata não estiver visível, use um nome amplo mas útil como 'Action figure colecionável', registre candidatos como hipóteses em attributes.suggestions e explique a incerteza. Sugestões devem ter confiança de 0 a 1 e uma justificativa visual curta. Use o campo version para ano/edição confirmados; hipóteses continuam em suggestions até o usuário confirmá-las.",
  "Se a imagem estiver obstruída ou não mostrar um produto, use name='Produto não identificado', confidence=0 e não crie sugestões. Considere o objeto central e somente evidências visíveis. Os quadros são temporários e não devem ser descritos como armazenados.",
].join(" ");

const responseModalities = [Modality.AUDIO];
const temperature = 0.1;
const maxOutputTokens = 1200;
const mediaResolution = MediaResolution.MEDIA_RESOLUTION_LOW;
const systemInstruction = { parts: [{ text: liveIdentificationPrompt }] };
export const identificationTool: Tool = {
  functionDeclarations: [{
    name: "report_product_identification",
    description: "Retorna a identificação visual do produto no formato estruturado exigido pelo RADAR.",
    behavior: Behavior.NON_BLOCKING,
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 240 },
        category: { type: "string", nullable: true, maxLength: 120 },
        subcategory: { type: "string", nullable: true, maxLength: 120 },
        brand: { type: "string", nullable: true, maxLength: 160 },
        model: { type: "string", nullable: true, maxLength: 160 },
        version: { type: "string", nullable: true, maxLength: 160 },
        description: { type: "string", nullable: true, maxLength: 1000 },
        attributes: {
          type: "object",
          additionalProperties: true,
          description: "Características observáveis e hipóteses revisáveis sem descartar atributos reconhecidos.",
          properties: {
            suggestions: {
              type: "array",
              maxItems: 8,
              description: "Hipóteses para campos que não podem ser confirmados visualmente.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  field: { type: "string", enum: ["category", "subcategory", "brand", "model", "version"] },
                  value: { type: "string", minLength: 1, maxLength: 160 },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  rationale: { type: "string", maxLength: 240 },
                },
                required: ["field", "value", "confidence", "rationale"],
              },
            },
          },
        },
        visibleCondition: { type: "string", nullable: true, maxLength: 500 },
        visibleDefects: { type: "array", maxItems: 30, items: { type: "string", maxLength: 300 } },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        identifiedInformation: { type: "array", maxItems: 30, items: { type: "string", maxLength: 300 } },
        uncertainInformation: { type: "array", maxItems: 30, items: { type: "string", maxLength: 300 } },
        verificationQuestions: { type: "array", maxItems: 20, items: { type: "string", maxLength: 300 } },
        searchQueries: { type: "array", maxItems: 5, items: { type: "string", minLength: 1, maxLength: 240 } },
        warnings: { type: "array", maxItems: 30, items: { type: "string", maxLength: 300 } },
      },
      required: [
        "name", "category", "subcategory", "brand", "model", "version", "description", "attributes",
        "visibleCondition", "visibleDefects", "confidence", "identifiedInformation", "uncertainInformation",
        "verificationQuestions", "searchQueries", "warnings",
      ],
    },
  }],
};
const tools: Tool[] = [identificationTool];

const liveConfig: LiveConnectConfig = {
  responseModalities,
  temperature,
  maxOutputTokens,
  mediaResolution,
  systemInstruction,
  tools,
};

export type GeminiLiveSession = {
  token: string;
  model: string;
  setup: {
    generationConfig: {
      responseModalities: string[];
      temperature: number;
      maxOutputTokens: number;
      mediaResolution: string;
    };
    systemInstruction: { parts: { text: string }[] };
    tools: Tool[];
  };
  expiresAt: string;
};

export async function createGeminiLiveSession(): Promise<GeminiLiveSession> {
  if (!env.GEMINI_API_KEY) throw new AppError("GEMINI_API_KEY não está configurada.", 503, "GEMINI_NOT_CONFIGURED");

  const now = Date.now();
  const expireTime = new Date(now + 5 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();

  try {
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, httpOptions: { apiVersion: "v1beta" } });
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model: env.GEMINI_LIVE_MODEL,
          config: liveConfig,
        },
      },
    });
    if (!token.name) throw new Error("O provedor não retornou o token temporário.");

    return {
      token: token.name,
      model: `models/${env.GEMINI_LIVE_MODEL}`,
      setup: {
        generationConfig: {
          responseModalities,
          temperature,
          maxOutputTokens,
          mediaResolution,
        },
        systemInstruction,
        tools,
      },
      expiresAt: expireTime,
    };
  } catch {
    throw new AppError("Não foi possível iniciar a sessão visual do Gemini. Tente novamente ou confira a configuração do servidor.", 502, "GEMINI_LIVE_SESSION_FAILED");
  }
}
