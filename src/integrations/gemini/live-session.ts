import { GoogleGenAI, MediaResolution, Modality, type LiveConnectConfig } from "@google/genai";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";

export const liveIdentificationPrompt = [
  "Identifique o produto visível na câmera para um aplicativo brasileiro de revenda.",
  "Responda somente com um objeto JSON válido, sem Markdown, usando exatamente estas propriedades:",
  "name (string), category (string|null), subcategory (string|null), brand (string|null), model (string|null), version (string|null), description (string|null), attributes (object), visibleCondition (string|null), visibleDefects (array of strings), confidence (number de 0 a 1), identifiedInformation (array of strings), uncertainInformation (array of strings), verificationQuestions (array of strings), searchQueries (array de no máximo 5 strings curtas em português), warnings (array of strings).",
  "Escreva em português brasileiro. Não invente marca, modelo, funcionamento, autenticidade ou preço. Se não for possível identificar o item, use name='Produto não identificado', confidence abaixo de 0.35 e explique o que falta em uncertainInformation.",
  "Considere somente o item central visível. A câmera enviará quadros temporários enquanto o usuário aponta o aparelho; use o quadro mais recente para a resposta.",
].join(" ");

const responseModalities = [Modality.TEXT];
const temperature = 0.1;
const maxOutputTokens = 1200;
const mediaResolution = MediaResolution.MEDIA_RESOLUTION_LOW;
const systemInstruction = { parts: [{ text: liveIdentificationPrompt }] };

const liveConfig: LiveConnectConfig = {
  responseModalities,
  temperature,
  maxOutputTokens,
  mediaResolution,
  systemInstruction,
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
      },
      expiresAt: expireTime,
    };
  } catch {
    throw new AppError("Não foi possível iniciar a sessão visual do Gemini. Tente novamente ou confira a configuração do servidor.", 502, "GEMINI_LIVE_SESSION_FAILED");
  }
}
