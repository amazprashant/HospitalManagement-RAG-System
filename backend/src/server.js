import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { runMigrations } from "./migrate.js";
import askRouter from "./routes/ask.js";
import uploadRouter from "./routes/upload.js";
import patientsRouter from "./routes/patients.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/ask", askRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/patients", patientsRouter);

app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 5000;

runMigrations()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to run migrations:", err);
    process.exit(1);
  });
