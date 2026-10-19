import dotenv from "dotenv";

dotenv.config();

export interface MCPToolParameter {
  type: string;
  description?: string;
  [key: string]: unknown;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, MCPToolParameter>;
    required?: string[];
  };
}

export interface MCPToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * MCPClientBridge
 * Client that connects to the ShiftWeave MCP Server over Streamable HTTP (/mcp).
 * Implements MCP specification 2025-11-25 with JSON-RPC 2.0 handshake,
 * dynamic runtime tool discovery (tools/list), and tool execution (tools/call).
 */
export class MCPClientBridge {
  private endpoint: string;
  private sessionId: string | null = null;
  private requestId = 1;

  constructor(endpoint = process.env.MCP_SERVER_URL || "http://localhost:3000/mcp") {
    this.endpoint = endpoint;
  }

  /**
   * Initializes stateful MCP session with the server via Streamable HTTP.
   */
  async initialize(): Promise<{ serverName: string; version: string; sessionId: string }> {
    const payload = {
      jsonrpc: "2.0",
      id: this.requestId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {
          tools: { listChanged: false }
        },
        clientInfo: {
          name: "ShiftWeave-Agent-Orchestrator",
          version: "1.0.0"
        }
      }
    };

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`MCP initialization failed with HTTP ${res.status}: ${await res.text()}`);
    }

    const sessionIdHeader = res.headers.get("mcp-session-id");
    if (sessionIdHeader) {
      this.sessionId = sessionIdHeader;
    }

    const text = await res.text();
    const data = this.parseJsonRpcResponse(text);

    if (data.error) {
      throw new Error(`MCP initialize error: ${data.error.message}`);
    }

    // Send initialized notification as required by MCP spec
    await this.sendNotification("notifications/initialized");

    return {
      serverName: data.result?.serverInfo?.name || "shiftweave-mcp-server",
      version: data.result?.protocolVersion || "2025-11-25",
      sessionId: this.sessionId || "stateless"
    };
  }

  /**
   * Dynamically discovers all available tools registered on the MCP server.
   */
  async listTools(): Promise<MCPToolDefinition[]> {
    const response = await this.sendRequest("tools/list", {});
    if (response.error) {
      throw new Error(`tools/list failed: ${response.error.message}`);
    }
    return (response.result?.tools || []) as MCPToolDefinition[];
  }

  /**
   * Invokes an MCP tool by name with arguments over Streamable HTTP.
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<MCPToolResult> {
    const response = await this.sendRequest("tools/call", {
      name,
      arguments: args
    });

    if (response.error) {
      return {
        content: [{ type: "text", text: `Tool Error [${name}]: ${response.error.message}` }],
        isError: true
      };
    }

    return response.result as MCPToolResult;
  }

  /**
   * Helper to send JSON-RPC 2.0 requests over Streamable HTTP
   */
  private async sendRequest(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream"
    };

    if (this.sessionId) {
      headers["mcp-session-id"] = this.sessionId;
    }

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.requestId++,
        method,
        params
      })
    });

    if (!res.ok && res.status !== 200) {
      const errText = await res.text();
      throw new Error(`MCP HTTP request to ${this.endpoint} failed (${res.status}): ${errText}`);
    }

    const text = await res.text();
    return this.parseJsonRpcResponse(text);
  }

  /**
   * Sends an asynchronous JSON-RPC notification (no id)
   */
  private async sendNotification(method: string, params: Record<string, unknown> = {}): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream"
    };

    if (this.sessionId) {
      headers["mcp-session-id"] = this.sessionId;
    }

    await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params
      })
    });
  }

  /**
   * Parses JSON-RPC responses, handling SSE formatting if present
   */
  private parseJsonRpcResponse(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      // Parse SSE chunk if server returned text/event-stream
      const lines = text.split("\n").filter(l => l.startsWith("data: "));
      if (lines.length > 0) {
        return JSON.parse(lines[0].replace("data: ", ""));
      }
      return { raw: text };
    }
  }

  getSessionId(): string | null {
    return this.sessionId;
  }
}
