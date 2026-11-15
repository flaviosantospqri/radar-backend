import { GoogleGenAI, Type } from "@google/genai";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import { identificationSchema } from "../../shared/validation.js";

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING }, category: { type: Type.STRING, nullable: true }, subcategory: { type: Type.STRING, nullable: true },
    brand: { type: Type.STRING, nullable: true }, model: { type: Type.STRING, nullable: true }, version: { type: Type.STRING, nullable: true },
    description: { type: Type.STRING, nullable: true }, attributes: { type: Type.OBJECT, properties: {} },
    visibleCondition: { type: Type.STRING, nullable: true }, visibleDefects: { type: Type.ARRAY, items: { type: Type.STRING } },
    confidence: { type: Type.NUMBER }, identifiedInformation: { type: Type.ARRAY, items: { type: Type.STRING } },
    uncertainInformation: { type: Type.ARRAY, items: { type: Type.STRING } }, verificationQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
    searchQueries: { type: Type.ARRAY, items: { type: Type.STRING } }, warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["name", "category", "subcategory", "brand", "model", "version", "description", "attributes", "visibleCondition", "visibleDefects", "confidence", "identifiedInformation", "uncertainInformation", "verificationQuestions", "searchQueries", "warnings"],
};

const ai = env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }) : null;
const prompt = `Identifique o produto da fotografia para um aplicativo de revenda brasileiro. Responda somente no JSON definido. Não estime preços, não use conhecimento de mercado nem invente anúncio. Não afirme funcionamento ou autenticidade por aparência. Se marca, modelo ou especificação não estiver legível, use null e explique a incerteza. confidence é uma estimativa visual de 0 a 1, não uma probabilidade comprovada. Descreva somente o que é visível. Crie até três consultas de pesquisa curtas em português. Escreva em português brasileiro.`;

export type IdentificationResult = ReturnType<typeof identificationSchema.parse>;

export async function identifyProduct(input: { image: Buffer; mimeType: string }) {
  if (!ai) throw new AppError("GEMINI_API_KEY não está configurada.", 503, "GEMINI_NOT_CONFIGURED");
  let rawText = "";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let usedCorrection = false;
  try {
    const makeRequest = async (correction?: string) => ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: [{ parts: [
        { inlineData: { mimeType: input.mimeType, data: input.image.toString("base64") } },
        { text: correction ? `Corrija a resposta anterior para corresponder ao schema. Retorne apenas JSON. Resposta: ${correction}` : prompt },
      ] }],
      config: { responseMimeType: "application/json", responseSchema, temperature: 0.1, maxOutputTokens: 1200 },
    });
    let response = await makeRequest();
    rawText = response.text ?? "";
    inputTokens = response.usageMetadata?.promptTokenCount ?? null;
    outputTokens = response.usageMetadata?.candidatesTokenCount ?? null;
    try {
      return { data: identificationSchema.parse(JSON.parse(rawText)), model: env.GEMINI_MODEL, inputTokens, outputTokens, usedCorrection };
    } catch {
      usedCorrection = true;
      response = await makeRequest(rawText.slice(0, 4000));
      rawText = response.text ?? "";
      inputTokens = inputTokens === null || response.usageMetadata?.promptTokenCount === undefined ? null : inputTokens + response.usageMetadata.promptTokenCount;
      outputTokens = outputTokens === null || response.usageMetadata?.candidatesTokenCount === undefined ? null : outputTokens + response.usageMetadata.candidatesTokenCount;
      return { data: identificationSchema.parse(JSON.parse(rawText)), model: env.GEMINI_MODEL, inputTokens, outputTokens, usedCorrection };
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    const err = error instanceof Error ? error.message : "Falha do provedor.";
    throw new AppError(`A identificação não foi validada: ${err.slice(0, 240)}`, 502, "GEMINI_IDENTIFICATION_FAILED");
  }
}

