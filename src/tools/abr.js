/**
 * ABR (Australian Business Register) lookup tool.
 *
 * API: https://abr.business.gov.au/json/
 * Requires a GUID from https://abr.business.gov.au/Tools/WebServicesAgreement
 *
 * Supports:
 *   - lookupByABN(abn) → business details
 *   - lookupByACN(acn) → business details
 *   - searchByName(name, maxResults) → list of matching businesses
 */

const fetch = require('node-fetch');

const ABR_GUID = process.env.ABR_GUID;
const ABR_BASE = 'https://abr.business.gov.au/json';

/**
 * Parse the JSONP response from ABR (strips callback wrapper).
 */
function parseABRResponse(text) {
  // Response looks like: callback({...})
  const match = text.match(/^[^(]+\((.+)\)$/s);
  if (!match) throw new Error('Unexpected ABR response format');
  return JSON.parse(match[1]);
}

/**
 * Normalise ABN details response into a clean object.
 */
function normaliseDetails(raw) {
  if (raw.Message && raw.Message !== '') {
    return { error: raw.Message };
  }
  return {
    abn: raw.Abn || null,
    acn: raw.Acn || null,
    status: raw.AbnStatus || null,          // 'Active' | 'Cancelled'
    statusSince: raw.AbnStatusEffectiveFrom || null,
    entityName: raw.EntityName || null,
    entityType: raw.EntityTypeName || null,
    entityTypeCode: raw.EntityTypeCode || null,
    gstRegistered: raw.Gst !== null && raw.Gst !== undefined,
    gstSince: raw.Gst || null,
    postcode: raw.AddressPostcode || null,
    state: raw.AddressState || null,
    businessNames: raw.BusinessName || []
  };
}

/**
 * Lookup by ABN.
 * @param {string} abn - 11-digit ABN (spaces allowed, will be stripped)
 * @returns {Promise<object>}
 */
async function lookupByABN(abn) {
  if (!ABR_GUID) throw new Error('ABR_GUID not configured. Register at abr.business.gov.au/Tools/WebServicesAgreement');
  const cleanABN = abn.replace(/\s/g, '');
  const url = `${ABR_BASE}/AbnDetails.aspx?abn=${encodeURIComponent(cleanABN)}&callback=callback&guid=${ABR_GUID}`;
  const res = await fetch(url);
  const text = await res.text();
  const raw = parseABRResponse(text);
  return normaliseDetails(raw);
}

/**
 * Lookup by ACN.
 * @param {string} acn - 9-digit ACN
 * @returns {Promise<object>}
 */
async function lookupByACN(acn) {
  if (!ABR_GUID) throw new Error('ABR_GUID not configured.');
  const cleanACN = acn.replace(/\s/g, '');
  const url = `${ABR_BASE}/AcnDetails.aspx?acn=${encodeURIComponent(cleanACN)}&callback=callback&guid=${ABR_GUID}`;
  const res = await fetch(url);
  const text = await res.text();
  const raw = parseABRResponse(text);
  return normaliseDetails(raw);
}

/**
 * Search by business/entity name.
 * @param {string} name
 * @param {number} maxResults - max 200
 * @returns {Promise<Array>}
 */
async function searchByName(name, maxResults = 10) {
  if (!ABR_GUID) throw new Error('ABR_GUID not configured.');
  const url = `${ABR_BASE}/MatchingNames.aspx?name=${encodeURIComponent(name)}&maxResults=${maxResults}&callback=callback&guid=${ABR_GUID}`;
  const res = await fetch(url);
  const text = await res.text();
  const raw = parseABRResponse(text);
  if (raw.Message && raw.Message !== '') return { error: raw.Message, results: [] };
  const names = raw.Names || [];
  return {
    results: names.map(n => ({
      abn: n.Abn,
      name: n.Name,
      state: n.State,
      postcode: n.Postcode,
      status: n.Status
    })),
    count: names.length
  };
}

/**
 * MCP tool descriptor — used to build the /mcp manifest.
 */
const descriptor = {
  name: 'abr_lookup',
  description: 'Look up Australian Business Register (ABR) records by ABN, ACN, or business name. Returns entity name, status (active/cancelled), GST registration, and address.',
  parameters: {
    type: 'object',
    properties: {
      abn: { type: 'string', description: 'Australian Business Number (11 digits)' },
      acn: { type: 'string', description: 'Australian Company Number (9 digits)' },
      name: { type: 'string', description: 'Business or entity name to search' },
      maxResults: { type: 'number', description: 'Max results for name search (default 10, max 200)' }
    }
  },
  examples: [
    { abn: '51 824 753 556' },
    { acn: '008 672 179' },
    { name: 'NorthWorld', maxResults: 5 }
  ]
};

/**
 * Execute the tool from an MCP tool call.
 */
async function execute(params) {
  if (params.abn) return await lookupByABN(params.abn);
  if (params.acn) return await lookupByACN(params.acn);
  if (params.name) return await searchByName(params.name, params.maxResults || 10);
  throw new Error('Provide one of: abn, acn, or name');
}

module.exports = { lookupByABN, lookupByACN, searchByName, descriptor, execute };
