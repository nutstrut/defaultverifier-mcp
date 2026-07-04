/**
 * DefaultVerifier MCP Server — Phase A
 *
 * Streamable HTTP MCP server exposing two tools:
 *   - verify_receipt: local-first SAR v0.1 receipt verification (offline)
 *   - get_verification_log: read /var/www/html/verified.json locally
 *
 * Dev port: 127.0.0.1:3013
 * Does not touch production nginx/pm2/settlement-witness-mcp.
 */

import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { TOOL_DEFINITION as verifyReceiptDef, handleVerifyReceipt } from './tools/verifyReceipt.js';
import { TOOL_DEFINITION as logDef, handleGetVerificationLog } from './tools/verificationLog.js';

const PORT = Number(process.env.PORT || 3013);
const HOST = process.env.HOST || '127.0.0.1';
const MCP_PATH = process.env.MCP_PATH || '/mcp';

const TOOLS = [verifyReceiptDef, logDef];
const HANDLERS = {
  verify_receipt: handleVerifyReceipt,
  get_verification_log: handleGetVerificationLog,
};

function buildServer() {
  const server = new Server(
    { name: 'DefaultVerifier MCP', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params?.name;
    const args = req.params?.arguments || {};

    const handler = HANDLERS[name];
    if (!handler) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: `Unknown tool: ${name}`, available: Object.keys(HANDLERS) }),
        }],
        isError: true,
      };
    }

    try {
      const result = await handler(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: `Tool error: ${e.message}`, tool: name }),
        }],
        isError: true,
      };
    }
  });

  return server;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true, server: 'DefaultVerifier MCP', version: '0.1.0', phase: 'A' }));

app.all(MCP_PATH, async (req, res) => {
  console.log('MCP_REQ', req.body?.method, req.body?.params?.name);

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({});

  res.on('close', () => {
    try { transport.close(); } catch {}
    try { server.close(); } catch {}
  });

  try {
    await server.connect(transport);

    const acc = (req.headers.accept || '').toLowerCase();
    if (!acc.includes('text/event-stream')) {
      req.headers.accept = 'application/json, text/event-stream';
    }

    const req2 = Object.create(req);
    req2.headers = { ...req.headers, accept: 'application/json, text/event-stream' };
    await transport.handleRequest(req2, res, req.body);
  } catch (e) {
    console.error('MCP_ERROR', e?.message || e);
    if (!res.headersSent) res.status(500).json({ error: 'MCP server error' });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`DefaultVerifier MCP Phase A listening on http://${HOST}:${PORT}${MCP_PATH}`);
  console.log('Tools: verify_receipt, get_verification_log');
});
