/**
 * API Key authentication middleware.
 *
 * Reads comma-separated keys from env: PARTNER_API_KEYS
 * Accepts the key from:
 *   - HTTP header: X-API-Key: <key>
 *   - HTTP header: Authorization: Bearer <key>
 *
 * If no keys are configured, the middleware rejects every request to avoid
 * accidentally exposing the partner endpoints in production.
 */
export function requireApiKey(req, res, next) {
  const raw = String(process.env.PARTNER_API_KEYS || "").trim();
  const keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  if (keys.length === 0) {
    return res.status(503).json({
      error:
        "API partenaire non configurée (PARTNER_API_KEYS manquante côté serveur).",
    });
  }

  const headerKey =
    req.headers["x-api-key"] ||
    req.headers["X-API-Key"] ||
    null;

  const authHeader = req.headers.authorization || "";
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  const bearerKey = bearerMatch ? bearerMatch[1].trim() : null;

  const provided = String(headerKey || bearerKey || "").trim();

  if (!provided) {
    return res.status(401).json({
      error: "Clé API manquante. Fournir l'en-tête X-API-Key.",
    });
  }

  if (!keys.includes(provided)) {
    return res.status(403).json({
      error: "Clé API invalide.",
    });
  }

  req.apiKey = provided;
  return next();
}
