import OpenAI from "openai";

if (!process.env.OPENROUTER_API_KEY) {
  console.warn("OPENROUTER_API_KEY not set — extraction will fail");
}

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
});

export const MODEL_ID = "google/gemini-3-flash-preview";
export default openai;
