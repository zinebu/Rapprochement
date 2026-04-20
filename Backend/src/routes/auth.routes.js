import express from "express";

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        message: "Email et mot de passe requis",
      });
    }

    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    const response = await fetch(
      `${process.env.ESPO_CRM_URL}/api/v1/App/user`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
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
    console.error("Erreur login EspoCRM:", error);
    return res.status(500).json({
      message: "Erreur serveur",
      details: String(error),
    });
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
