/**
 * MCP API key authentication + freemium gate middleware.
 *
 * Tier logic:
 *   - No key provided → freemium (10 free calls per IP, then block with Stripe link)
 *   - Valid key, tier=free → 10 call limit total, then block
 *   - Valid key, tier=paid → unlimited
 *   - Invalid key → 401
 */

const { getKey, getAnonCount, incrementAnonCount } = require('../db/database');

const FREE_CALL_LIMIT = parseInt(process.env.FREE_CALL_LIMIT || '10', 10);
const STRIPE_PAYMENT_LINK = process.env.STRIPE_PAYMENT_LINK || 'https://northworld.com.au/mcp-api';

function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;

  if (!apiKey) {
    // Freemium: check anonymous IP counter
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const count = getAnonCount(ip);

    if (count >= FREE_CALL_LIMIT) {
      return res.status(402).json({
        error: 'free_tier_exhausted',
        message: `You've used all ${FREE_CALL_LIMIT} free calls. Upgrade to continue.`,
        upgrade_url: STRIPE_PAYMENT_LINK,
        calls_used: count,
        limit: FREE_CALL_LIMIT
      });
    }

    // Allow — attach context for logging
    req.authContext = { key: null, tier: 'anon', ip, callCount: count };
    return next();
  }

  // Validate key
  const keyRow = getKey(apiKey);
  if (!keyRow) {
    return res.status(401).json({
      error: 'invalid_api_key',
      message: 'The provided API key is not recognised.'
    });
  }

  if (keyRow.tier === 'free' && keyRow.call_count >= FREE_CALL_LIMIT) {
    return res.status(402).json({
      error: 'free_tier_exhausted',
      message: `Your free tier is exhausted (${FREE_CALL_LIMIT} calls used). Upgrade to continue.`,
      upgrade_url: STRIPE_PAYMENT_LINK,
      calls_used: keyRow.call_count,
      limit: FREE_CALL_LIMIT
    });
  }

  req.authContext = { key: apiKey, tier: keyRow.tier, owner: keyRow.owner, callCount: keyRow.call_count };
  return next();
}

module.exports = { authMiddleware };
