export async function classifyWithOpenClaw({
  fileName,
  mimeType,
  extractedText,
  structuredData,
}) {
  const enabled = process.env.OPENCLAW_ENABLED === "true";

  if (!enabled) {
    return {
      label: "unknown",
      confidence: 0,
      fields: {},
      provider: "disabled",
      raw: null,
    };
  }

  const url = process.env.OPENCLAW_URL;
  const apiKey = process.env.OPENCLAW_API_KEY;

  if (!url) {
    throw new Error("OPENCLAW_URL manquante dans le .env");
  }

  const payload = {
    fileName,
    mimeType,
    text: extractedText,
    structuredData,
  };

  const headers = {
    "Content-Type": "application/json",
  };

  if (apiKey && apiKey !== "replace_me") {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Réponse OpenClaw non JSON (status ${response.status})`);
  }

  if (!response.ok) {
    throw new Error(
      `OpenClaw error ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return {
    label: data.label ?? "unknown",
    confidence: data.confidence ?? 0,
    fields: data.fields ?? {},
    provider: "openclaw",
    raw: data,
  };
}