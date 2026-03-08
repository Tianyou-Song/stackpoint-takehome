import { GoogleGenerativeAI } from "@google/generative-ai";

if (!process.env.GOOGLE_API_KEY) {
  console.warn("GOOGLE_API_KEY not set — extraction will fail");
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? "");

// gemini-3-flash-preview: top ExtractBench score, structured JSON output via responseSchema
export const model = genAI.getGenerativeModel({
  model: "gemini-3-flash-preview",
  generationConfig: {
    responseMimeType: "application/json",
    temperature: 0.1,
  },
});

export default genAI;
