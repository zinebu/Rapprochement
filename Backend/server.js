import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import invoiceRoutes from "./src/routes/invoice.routes.js";
import reviewRoutes from "./src/routes/review.routes.js";
import bridgeRoutes from "./src/routes/bridge.routes.js";
import importRoutes from "./src/routes/import.routes.js";
import { connectMongo } from "./src/lib/mongoose.js";

const app = express();
const PORT = process.env.PORT || 8000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Backend API is running",
  });
});

app.use("/api", reviewRoutes);
app.use("/api", invoiceRoutes);
app.use("/api", importRoutes);
app.use("/api/bridge", bridgeRoutes);

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Erreur serveur",
    details: String(err),
  });
});

async function start() {
  await connectMongo();

  app.listen(PORT, () => {
    console.log(`Backend lancé sur http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Erreur démarrage serveur:", error);
  process.exit(1);
});