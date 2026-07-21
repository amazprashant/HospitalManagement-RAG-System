import { Router } from "express";
import { retrieveTopChunks } from "../retrieve.js";
import { generateAnswer } from "../generate.js";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "question is required" });
    }

    const chunks = await retrieveTopChunks(question, 3);
    const answer = await generateAnswer(question, chunks);

    res.json({
      answer,
      sources: chunks.map((c) => ({
        file: c.source_file,
        chunk: c.chunk_index,
        similarity: Number(c.similarity.toFixed(4)),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to answer question" });
  }
});

export default router;
