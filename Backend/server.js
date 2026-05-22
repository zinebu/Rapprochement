import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import session from "express-session";
import { fileURLToPath } from "url";

import authRoutes from "./src/routes/auth.routes.js";
import invoiceRoutes from "./src/routes/invoice.routes.js";
import reviewRoutes from "./src/routes/review.routes.js";
import bridgeRoutes from "./src/routes/bridge.routes.js";
import importRoutes from "./src/routes/import.routes.js";
import reconciliationRoutes from "./src/routes/reconciliation.routes.js";
import partnerRoutes from "./src/routes/partner.routes.js";
import { connectMongo } from "./src/lib/mongoose.js";
import { recoverStuckReconciliationJobs } from "./src/services/reconciliation-job.service.js";

const app = express();
const PORT = process.env.PORT || 8000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("trust proxy", 1);

app.use((req, res, next) => {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[http] ${req.method} ${req.url}`);
  }
  next();
});

const allowedOrigins = [
  "https://rapp.consult-it.com",
  "http://localhost:8080",
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (/^http:\/\/localhost:\d+$/i.test(origin)) return callback(null, true);
      return callback(new Error(`Origin non autorisée: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "rapp.sid",
    secret: process.env.SESSION_SECRET || "change-this-secret",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      // "auto" keeps cookies working on localhost (HTTP) and secures them on HTTPS.
      secure: "auto",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Backend API is running",
  });
});

app.use("/auth", authRoutes);
app.use("/api", reviewRoutes);
app.use("/api", invoiceRoutes);
app.use("/api", importRoutes);
app.use("/api", reconciliationRoutes);
app.use("/api/bridge", bridgeRoutes);
app.use("/api/partner", partnerRoutes);

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Erreur serveur",
    details: process.env.NODE_ENV === "production" ? undefined : String(err),
  });
});

async function start() {
  await connectMongo();

  const shouldRecoverStuckJobs =
    process.env.NODE_ENV === "production" ||
    process.env.RECOVER_RECONCILIATION_ON_STARTUP === "true";

  if (shouldRecoverStuckJobs) {
    recoverStuckReconciliationJobs()
      .then((meta) => {
        if (meta?.enqueued > 0) {
          console.log(
            `[reconciliation] ${meta.enqueued} job(s) relancé(s) après traitement bloqué`
          );
        }
      })
      .catch((err) => {
        console.warn("[reconciliation] recover stuck jobs:", err?.message || err);
      });
  } else {
    console.log("[reconciliation] récupération au démarrage désactivée en développement");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend lancé sur le port ${PORT}`);
  });
}

start().catch((error) => {
  console.error("Erreur démarrage serveur:", error);
  process.exit(1);
});
