import express from "express";

const router = express.Router();
const ESPO_LOGIN_TIMEOUT_MS = 10000;

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

router.post("/login", async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ESPO_LOGIN_TIMEOUT_MS);

  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        message: "Email et mot de passe requis",
      });
    }

    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    const espoUrl = String(process.env.ESPO_CRM_URL || "").replace(/\/$/, "");

    if (!espoUrl) {
      return res.status(500).json({
        message: "ESPO_CRM_URL non configuré",
      });
    }

    const response = await fetch(
      `${espoUrl}/api/v1/App/user`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      }
    );

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok || !data?.user) {
      return res.status(401).json({
        message: "Identifiants invalides",
      });
    }

    req.session.user = {
      id: data.user.id,
      username: data.user.userName || username,
      name: data.user.name || null,
      email: data.user.emailAddress || username,
      role: data.user.type || null,
    };

    return res.json({
      success: true,
      user: req.session.user,
    });
  } catch (error) {
    if (isAbortError(error)) {
      return res.status(504).json({
        message: "Connexion EspoCRM trop longue. Réessayez.",
      });
    }

    console.error("Erreur login EspoCRM:", error);
    return res.status(500).json({
      message: "Erreur serveur",
      details: String(error),
    });
  } finally {
    clearTimeout(timeout);
  }
});

router.get("/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      authenticated: false,
    });
  }

  return res.json({
    authenticated: true,
    user: req.session.user,
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("rapp.sid");
    res.json({ success: true });
  });
});

export default router;
