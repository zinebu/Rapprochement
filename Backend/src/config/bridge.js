export const BRIDGE_VERSION = process.env.BRIDGE_VERSION || "2025-01-15";
export const BRIDGE_BASE_URL = "https://api.bridgeapi.io/v3/aggregation";

export function bridgeHeaders(extra = {}) {
  return {
    "Bridge-Version": BRIDGE_VERSION,
    "Client-Id": process.env.BRIDGE_CLIENT_ID,
    "Client-Secret": process.env.BRIDGE_CLIENT_SECRET,
    accept: "application/json",
    "content-type": "application/json",
    ...extra,
  };
}
