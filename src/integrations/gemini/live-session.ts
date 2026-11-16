import { GoogleGenAI, MediaResolution, Modality, type LiveConnectConfig, type Tool } from "@google/genai";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";

export const liveIdentificationPrompt = [
  "Identifique o produto visível na câmera para um aplicativo brasileiro de revenda.",
  "Retorne a identificação chamando a função report_product_identification. Não responda em texto nem fale em voz alta.",
  "Escreva em português brasileiro. Não invente marca, modelo, funcionamento, autenticidade ou preço. Se não for possível identificar o item, use name='Produto não identificado', confidence abaixo de 0.35 e explique o que falta em uncertainInformation.",
  "Considere somente o item central visível. A câmera enviará quadros temporários enquanto o usuário aponta o aparelho; use o quadro mais recente para a resposta.",
].join(" ");

const responseModalities = [Modality.AUDIO];
const temperature = 0.1;
const maxOutputTokens = 1200;
const mediaResolution = MediaResolution.MEDIA_RESOLUTION_LOW;
const systemInstruction = { parts: [{ text: liveIdentificationPrompt }] };
const identificationTool: Tool = {
  functionDeclarations: [{
    name: "report_product_identification",
    description: "Retorna a identificação visual do produto no formato estruturado exigido pelo RADAR.",
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
          description: "Características observáveis do produto em pares chave-valor.",
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
