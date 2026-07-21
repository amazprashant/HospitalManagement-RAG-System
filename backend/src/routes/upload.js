import { Router } from "express";
import multer from "multer";
import path from "path";
import { ingestFile } from "../ingest.js";

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.resolve(process.cwd(), "documents")),
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });

router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "file is required" });
    }

    const result = await ingestFile(req.file.path);

    res.json({
      status: "success",
      chunksAdded: result.chunksAdded,
      file: result.file,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to ingest file" });
  }
});

export default router;
