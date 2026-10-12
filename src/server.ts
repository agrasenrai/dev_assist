import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { randomUUID } from "crypto";

const app = express();

app.use(express.json());

const server = new McpServer({
  name: "dev-assist",
  version: "1.0.0",
});

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  await server.connect(transport);

  await transport.handleRequest(req, res, req.body);
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Dev Assist MCP server running on http://localhost:${PORT}/mcp`);
});
