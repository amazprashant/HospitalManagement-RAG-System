import { GoogleGenAI } from "@google/genai";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT = `You are a hospital assistant. Answer the question using ONLY the context below.
If the answer isn't in the context, say "I don't have that information."`;

export async function generateAnswer(question, chunks) {
  const context = chunks
    .map((c) => `[${c.source_file} #${c.chunk_index}] ${c.chunk_text}`)
    .join("\n\n");

  const response = await genai.models.generateContent({
    model: "gemma-4-26b-a4b-it",
    contents: `${SYSTEM_PROMPT}\n\nContext:\n${context}\n\nQuestion: ${question}`,
  });

  return response.text;
}

const PATIENT_SYSTEM_PROMPT = `You are a hospital assistant answering questions about a specific patient.
Answer the question using ONLY the patient record below. If the answer isn't in the record, say "I don't have that information."`;

export async function generatePatientAnswer(question, profile) {
  const { patient, history, medications } = profile;

  const historyText = history.length
    ? history
        .map(
          (h) =>
            `- ${h.condition_name} (status: ${h.status}${h.diagnosed_date ? `, diagnosed: ${h.diagnosed_date.toISOString().slice(0, 10)}` : ""})${h.notes ? ` — ${h.notes}` : ""}`
        )
        .join("\n")
    : "No recorded medical history.";

  const medicationsText = medications.length
    ? medications
        .map(
          (m) =>
            `- ${m.medication_name}${m.dosage ? `, ${m.dosage}` : ""}${m.frequency ? `, ${m.frequency}` : ""}${m.prescribed_by ? ` (prescribed by ${m.prescribed_by})` : ""}`
        )
        .join("\n")
    : "No current medications.";

  const context = `Patient: ${patient.name}, Age: ${patient.age}, Gender: ${patient.gender}, Blood Group: ${patient.blood_group || "unknown"}

Medical History:
${historyText}

Medications:
${medicationsText}`;

  const response = await genai.models.generateContent({
    model: "gemma-4-26b-a4b-it",
    contents: `${PATIENT_SYSTEM_PROMPT}\n\nPatient Record:\n${context}\n\nQuestion: ${question}`,
  });

  return response.text;
}
