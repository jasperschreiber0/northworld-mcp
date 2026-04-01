/**
 * NDIS Provider Registry lookup tool.
 *
 * The NDIS provider register is publicly available at:
 *   https://www.ndis.gov.au/participants/working-with-providers/find-registered-provider
 *
 * NDIS exposes an undocumented API used by the public-facing search:
 *   GET https://www.ndis.gov.au/api/provider/search
 *   Query params: postcode, radius, supportCategory, registrationGroup
 *
 * This tool wraps that API for programmatic access.
 *
 * Support categories (common):
 *   01 - Daily Activities
 *   02 - Transport
 *   03 - Consumables
 *   04 - Assistance with Social, Economic and Community Participation
 *   05 - Assistive Technology
 *   06 - Home Modifications
 *   07 - Support Coordination
 *   08 - Improved Living Arrangements
 *   09 - Increased Social & Community Participation
 *   10 - Finding & Keeping a Job
 *   11 - Improved Health & Wellbeing
 *   12 - Improved Learning
 *   13 - Improved Life Choices
 *   14 - Improved Daily Living
 *   15 - Improved Relationships
 *   16 - Improved Housing
 *   17 - Specialist Disability Accommodation
 */

const fetch = require('node-fetch');

const NDIS_API_BASE = 'https://www.ndis.gov.au/api/provider';
const NDIS_SEARCH_BASE = 'https://www.ndis.gov.au';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; NorthWorld-MCP/1.0; +https://northworld.com.au)',
  'Accept': 'application/json',
  'Referer': 'https://www.ndis.gov.au/participants/working-with-providers/find-registered-provider'
};

/**
 * Search for NDIS registered providers.
 *
 * @param {object} params
 * @param {string} [params.postcode] - Australian postcode
 * @param {number} [params.radius] - Search radius in km (default 10)
 * @param {string} [params.supportCategory] - Support category number as string e.g. '07'
 * @param {string} [params.registrationGroup] - Registration group code
 * @param {string} [params.providerName] - Provider name search
 * @param {number} [params.limit] - Max results (default 20)
 * @returns {Promise<object>}
 */
async function searchProviders({ postcode, radius = 10, supportCategory, registrationGroup, providerName, limit = 20 }) {
  if (!postcode && !providerName) {
    throw new Error('Provide at least one of: postcode, providerName');
  }

  const params = new URLSearchParams();
  if (postcode) params.set('postcode', postcode);
  if (radius) params.set('radius', String(radius));
  if (supportCategory) params.set('supportCategory', supportCategory);
  if (registrationGroup) params.set('registrationGroup', registrationGroup);
  if (providerName) params.set('name', providerName);
  params.set('limit', String(limit));

  try {
    const url = `${NDIS_API_BASE}/search?${params.toString()}`;
    const res = await fetch(url, { headers: HEADERS, timeout: 15000 });

    if (res.status === 404 || res.status === 403) {
      // API endpoint may have changed — return structured fallback
      return {
        status: 'api_unavailable',
        message: 'NDIS provider API endpoint not accessible. The public register can be accessed manually.',
        manual_lookup_url: `https://www.ndis.gov.au/participants/working-with-providers/find-registered-provider`,
        search_params: { postcode, radius, supportCategory, providerName },
        note: 'NDIS uses an undocumented API. Check browser devtools at the manual URL to get the current endpoint.'
      };
    }

    if (!res.ok) {
      throw new Error(`NDIS API returned HTTP ${res.status}`);
    }

    const data = await res.json();
    return normaliseNDISResponse(data, { postcode, supportCategory });

  } catch (err) {
    if (err.message.includes('NDIS API')) throw err;

    // Network/parse error — return graceful fallback
    return {
      status: 'error',
      error: err.message,
      manual_lookup_url: `https://www.ndis.gov.au/participants/working-with-providers/find-registered-provider`,
      search_params: { postcode, radius, supportCategory, providerName }
    };
  }
}

/**
 * Normalise NDIS API response.
 */
function normaliseNDISResponse(data, context) {
  const providers = data.providers || data.results || data || [];

  if (!Array.isArray(providers)) {
    return { status: 'unexpected_format', raw: data };
  }

  return {
    status: 'ok',
    count: providers.length,
    postcode: context.postcode || null,
    supportCategory: context.supportCategory || null,
    providers: providers.map(p => ({
      name: p.name || p.providerName || null,
      registrationNumber: p.registrationNumber || p.regNumber || null,
      address: p.address || null,
      suburb: p.suburb || null,
      state: p.state || null,
      postcode: p.postcode || null,
      phone: p.phone || null,
      email: p.email || null,
      website: p.website || null,
      supportCategories: p.supportCategories || p.categories || [],
      registrationGroups: p.registrationGroups || [],
      distance_km: p.distance || null
    }))
  };
}

/**
 * MCP tool descriptor.
 */
const descriptor = {
  name: 'ndis_provider_lookup',
  description: 'Search for NDIS (National Disability Insurance Scheme) registered providers in Australia. Filter by postcode, support category, and radius. Returns provider name, contact details, support categories, and registration details.',
  parameters: {
    type: 'object',
    properties: {
      postcode: { type: 'string', description: 'Australian postcode to search near' },
      radius: { type: 'number', description: 'Search radius in km (default 10)' },
      supportCategory: {
        type: 'string',
        description: 'Support category number: 01=Daily Activities, 07=Support Coordination, 14=Improved Daily Living, etc.'
      },
      providerName: { type: 'string', description: 'Provider name to search for' },
      limit: { type: 'number', description: 'Max results to return (default 20)' }
    }
  },
  examples: [
    { postcode: '2000', radius: 10, supportCategory: '07' },
    { providerName: 'Scope' },
    { postcode: '3000', supportCategory: '01', limit: 50 }
  ]
};

async function execute(params) {
  return await searchProviders(params);
}

module.exports = { searchProviders, descriptor, execute };
