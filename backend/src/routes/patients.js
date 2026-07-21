import { Router } from "express";
import { listPatients, getPatientProfile } from "../patients.js";
import { generatePatientAnswer } from "../generate.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const patients = await listPatients();
    res.json({ patients });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list patients" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const profile = await getPatientProfile(req.params.id);
    if (!profile) {
      return res.status(404).json({ error: "Patient not found" });
    }
    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch patient" });
  }
});

router.post("/:id/ask", async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "question is required" });
    }

    const profile = await getPatientProfile(req.params.id);
    if (!profile) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const answer = await generatePatientAnswer(question, profile);

    res.json({
      answer,
      patient: { id: profile.patient.id, name: profile.patient.name },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to answer question" });
  }
});

export default router;
