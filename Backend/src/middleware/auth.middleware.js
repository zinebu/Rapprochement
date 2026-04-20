export function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      message: "Non authentifié",
    });
  }

  next();
}

export function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      message: "Non authentifié",
    });
  }

  if (req.session.user.role !== "admin") {
    return res.status(403).json({
      message: "Accès interdit",
    });
  }

  next();
}
