const clients = new Set();

export function registerSseClient(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(": connected\n\n");
  clients.add(res);
  res.on("close", () => {
    clients.delete(res);
  });
}

export function broadcastReconciliationEvent(payload) {
  const data = JSON.stringify(payload);
  for (const client of clients) {
    try {
      client.write(`event: message\n`);
      client.write(`data: ${data}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}
