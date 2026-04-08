/**
 * NorthWorld MCP Server
 *
 * Exposes Australian data tools (ABR, AHPRA, NDIS, Apollo) via a standardised
 * MCP-compatible REST API. Includes API key auth, freemium gate, and usage logging.
 *
 * Endpoints:
 *   GET  /health           — health check
 *   GET  /mcp              — tool manifest (all available tools)
 *   POST /mcp/call         — call a tool by name
 *   GET  /mcp/tools/:name  — get a single tool descriptor
 *   GET  /admin/stats      — usage stats (requires admin key)
 *
 * Tool-specific convenience endpoints (for ClawHub skills):
 *   POST /tools/abr        — ABR lookup
 *   POST /tools/ahpra      — AHPRA practitioner lookup
 *   POST /tools/ndis       — NDIS provider search
 *   POST /tools/apollo     — Apollo enrichment
 */

require('dotenv').config();

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('./middleware/auth');
const { logCall, incrementAnonCount, getDailySummary } = require('./db/database');

// Tool registry
const tools = {
  abr_lookup: require('./tools/abr'),
  ahpra_lookup: require('./tools/ahpra'),
  ndis_provider_lookup: require('./tools/ndis'),
  apollo_enrichment: require('./tools/apollo')
};

const app = express();
app.use(express.json());

// Trust proxy for correct IP detection on Railway
app.set('trust proxy', 1);

// ─────────────────────────────────────────────
// Health check — no auth required
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'northworld-mcp',
    version: '1.0.0',
    tools: Object.keys(tools),
    timestamp: new Date().toISOString()
  });
});

// ─────────────────────────────────────────────
// MCP manifest — no auth required
// ─────────────────────────────────────────────
app.get('/mcp', (req, res) => {
  const manifest = {
    name: 'northworld-mcp',
    version: '1.0.0',
    description: 'NorthWorld Australian Business Intelligence MCP Server — ABR, AHPRA, NDIS, Apollo',
    publisher: 'NorthWorld',
    tools: Object.values(tools).map(t => t.descriptor),
    auth: {
      type: 'api_key',
      header: 'X-Api-Key',
      freemium: {
        enabled: true,
        limit: parseInt(process.env.FREE_CALL_LIMIT || '10', 10),
        upgrade_url: process.env.STRIPE_PAYMENT_LINK || 'https://northworld.com.au/mcp-api'
      }
    }
  };
  res.json(manifest);
});

// ─────────────────────────────────────────────
// Single tool descriptor — no auth required
// ─────────────────────────────────────────────
app.get('/mcp/tools/:name', (req, res) => {
  const tool = tools[req.params.name];
  if (!tool) return res.status(404).json({ error: 'tool_not_found', tool: req.params.name });
  res.json(tool.descriptor);
});

// ─────────────────────────────────────────────
// MCP tool call — auth required
// ─────────────────────────────────────────────
app.post('/mcp/call', authMiddleware, async (req, res) => {
  const { tool: toolName, params = {} } = req.body;

  if (!toolName) {
    return res.status(400).json({ error: 'missing_field', message: 'Provide "tool" in request body' });
  }

  const tool = tools[toolName];
  if (!tool) {
    return res.status(404).json({ error: 'tool_not_found', tool: toolName });
  }

  const start = Date.now();
  const ctx = req.authContext;

  try {
    const result = await tool.execute(params);
    const latency = Date.now() - start;

    // Log the call
    logCall({ key: ctx.key, tool: toolName, input: params, success: true, latencyMs: latency });

    // Increment anon counter if no key
    if (!ctx.key) {
      incrementAnonCount(ctx.ip);
    }

    return res.json({
      tool: toolName,
      result,
      meta: {
        latency_ms: latency,
        tier: ctx.tier,
        calls_used: ctx.callCount + 1
      }
    });

  } catch (err) {
    const latency = Date.now() - start;
    logCall({ key: ctx.key, tool: toolName, input: params, success: false, latencyMs: latency });

    return res.status(500).json({
      error: 'tool_error',
      tool: toolName,
      message: err.message
    });
  }
});

// ─────────────────────────────────────────────
// Convenience endpoints — auth required
// ─────────────────────────────────────────────
function makeToolRoute(toolName) {
  return async (req, res) => {
    const tool = tools[toolName];
    const start = Date.now();
    const ctx = req.authContext;

    try {
      const result = await tool.execute(req.body);
      const latency = Date.now() - start;
      logCall({ key: ctx.key, tool: toolName, input: req.body, success: true, latencyMs: latency });
      if (!ctx.key) incrementAnonCount(ctx.ip);

      return res.json({ result, meta: { latency_ms: latency, tier: ctx.tier } });
    } catch (err) {
      const latency = Date.now() - start;
      logCall({ key: ctx.key, tool: toolName, input: req.body, success: false, latencyMs: latency });
      return res.status(500).json({ error: 'tool_error', message: err.message });
    }
  };
}

app.post('/tools/abr',    authMiddleware, makeToolRoute('abr_lookup'));
app.post('/tools/ahpra',  authMiddleware, makeToolRoute('ahpra_lookup'));
app.post('/tools/ndis',   authMiddleware, makeToolRoute('ndis_provider_lookup'));
app.post('/tools/apollo', authMiddleware, makeToolRoute('apollo_enrichment'));

// ─────────────────────────────────────────────
// Admin stats — requires ADMIN_KEY header
// ─────────────────────────────────────────────
app.get('/admin/stats', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const summary = getDailySummary();
  res.json(summary);
});
app.post('/mcp', (req, res) => {
  const { method } = req.body;
  
  if (method === 'tools/list') {
    return res.json({
      jsonrpc: '2.0',
      id: req.body.id,
      result: {
        tools: Object.values(tools).map(t => t.descriptor)
      }
    });
  }

  if (method === 'tools/call') {
    // forward to existing /mcp/call logic
    const { name, arguments: params } = req.body.params;
    req.body.tool = name;
    req.body.params = params;
    return app._router.handle({ ...req, url: '/mcp/call', method: 'POST' }, res, () => {});
  }

  res.status(404).json({ error: 'method_not_found' });
});
// ─────────────────────────────────────────────
// 404 handler
// ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'not_found',
    available_endpoints: ['GET /health', 'GET /mcp', 'POST /mcp/call', 'POST /tools/abr', 'POST /tools/ahpra', 'POST /tools/ndis', 'POST /tools/apollo']
  });
});

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`NorthWorld MCP Server running on port ${PORT}`);
  console.log(`Tools: ${Object.keys(tools).join(', ')}`);
  console.log(`ABR GUID: ${process.env.ABR_GUID ? 'configured' : '⚠️  NOT SET — register at abr.business.gov.au'}`);
  console.log(`Apollo: ${process.env.APOLLO_API_KEY ? 'configured' : '⚠️  NOT SET'}`);
});

module.exports = app;
