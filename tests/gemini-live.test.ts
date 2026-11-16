import { describe, expect, it } from "vitest";
import { Behavior } from "@google/genai";
import { identificationTool } from "../src/integrations/gemini/live-session.js";
import { identificationSchema } from "../src/shared/validation.js";

const baseIdentification = {
  name: "Action figure colecionável",
  category: "Brinquedo",
  subcategory: null,
  brand: null,
  model: null,
  version: null,
  description: null,
  attributes: {},
  visibleCondition: null,
  visibleDefects: [],
  confidence: 0.28,
  identifiedInformation: ["Figura articulada"],
  uncertainInformation: ["Personagem e edição não confirmados"],
  verificationQuestions: ["É possível identificar a marca na embalagem?"],
  searchQueries: ["action figure colecionável"],
  warnings: [],
};

describe("Gemini Live partial identification", () => {
  it("keeps the identification function non-blocking for continuous frames", () => {
    expect(identificationTool.functionDeclarations?.[0]?.behavior).toBe(Behavior.NON_BLOCKING);
  });

  it("persists suggested type and edition as bounded, reviewable attributes", () => {
    const result = identificationSchema.parse({
      ...baseIdentification,
      attributes: {
        suggestions: [
          { field: "subcategory", value: "Action figure de anime", confidence: 0.72, rationale: "Formato e pintura da figura" },
          { field: "version", value: "Edição 2024", confidence: 0.38, rationale: "Acessório lembra essa edição" },
        ],
      },
    });
    expect(result.attributes.suggestions).toHaveLength(2);
  });

  it("rejects suggestions with invalid confidence or fields", () => {
    expect(() => identificationSchema.parse({
      ...baseIdentification,
      attributes: { suggestions: [{ field: "price", value: "R$ 200", confidence: 2, rationale: "não confirmado" }] },
    })).toThrow();
  });

  it("continues to preserve regular product attributes", () => {
    const result = identificationSchema.parse({
      ...baseIdentification,
      attributes: { color: "vermelho", articulated: true },
    });
    expect(result.attributes).toEqual({ color: "vermelho", articulated: true });
  });
});
