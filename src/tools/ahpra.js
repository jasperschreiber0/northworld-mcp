/**
 * AHPRA (Australian Health Practitioner Regulation Agency) lookup tool.
 *
 * AHPRA has no public JSON API. This tool scrapes the public register search.
 * URL: https://www.ahpra.gov.au/Registration/Registers-of-Practitioners.aspx
 *
 * Search endpoint (discovered via browser devtools):
 *   POST https://www.ahpra.gov.au/api/register/search
 *   or GET https://www.ahpra.gov.au/Registration/Registers-of-Practitioners.aspx
 *   with query params for the search form.
 *
 * NOTE: AHPRA blocks automated requests. Strategy:
 *   1. Try the undocumented API endpoint first
 *   2. Fall back to structured scraping with a User-Agent header
 *   3. Cache results in SQLite to reduce repeat requests
 *
 * ⚠️  AHPRA's terms allow lookup for public verification purposes.
 *     Do not bulk-scrape. Rate limit to 1 req/sec.
 *
 * Professions supported:
 *   MED (Medical), NUR (Nursing & Midwifery), PHY (Physiotherapy),
 *   PSY (Psychology), DEN (Dental), PHR (Pharmacy), OCC (Occupational Therapy),
 *   OPT (Optometry), ORT (Osteopathy), POD (Podiatry), CHI (Chiropractic),
 *   RAD (Medical Radiation Practice), PAR (Paramedicine),
 *   ATS (Aboriginal & Torres Strait Islander Health Practice), CMB (Chinese Medicine)
 */

const fetch = require('node-fetch');

const AHPRA_SEARCH_URL = 'https://www.ahpra.gov.au/Registration/Registers-of-Practitioners.aspx';
const AHPRA_API_URL = 'https://www.ahpra.gov.au/Webservices/ahpra.registration.webservice.asmx';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; NorthWorld-MCP/1.0; +https://northworld.com.au)',
  'Accept': 'application/json, text/html',
  'Accept-Language': 'en-AU,en;q=0.9'
};

/**
 * Search AHPRA register by practitioner name and/or registration number.
 *
 * @param {object} params
 * @param {string} [params.name] - Practitioner name (first, last, or full)
 * @param {string} [params.registrationNumber] - e.g. MED0001234567
 * @param {string} [params.profession] - Profession code e.g. 'MED', 'NUR', 'PHY'
 * @param {string} [params.state] - State/territory filter e.g. 'NSW', 'VIC'
 * @returns {Promise<object>}
 */
async function searchPractitioner({ name, registrationNumber, profession, state }) {
  if (!name && !registrationNumber) {
    throw new Error('Provide at least one of: name, registrationNumber');
  }

  // Build query params for the AHPRA search form
  const params = new URLSearchParams();
  if (name) params.set('SearchTerm', name);
  if (registrationNumber) params.set('RegistrationNumber', registrationNumber);
  if (profession) params.set('Profession', profession);
  if (state) params.set('PrincipalPlaceOfPractice', state);
  params.set('OutputFormat', 'JSON');

  try {
    const url = `${AHPRA_SEARCH_URL}?${params.toString()}`;
    const res = await fetch(url, { headers: HEADERS, timeout: 15000 });

    if (!res.ok) {
      throw new Error(`AHPRA returned HTTP ${res.status}`);
    }

    const contentType = res.headers.get('content-type') || '';

    // If we got JSON back directly (undocumented API path), parse it
    if (contentType.includes('application/json')) {
      const data = await res.json();
      return normaliseAHPRAResponse(data);
    }

    // HTML response — AHPRA doesn't have a public API, we need to guide user
    // Return a structured "manual check" response rather than failing silently
    return {
      status: 'html_only',
      message: 'AHPRA does not expose a public JSON API. Verification requires a browser session or registered AHPRA API access.',
      manual_lookup_url: `https://www.ahpra.gov.au/Registration/Registers-of-Practitioners.aspx`,
      search_params: {
        name: name || null,
        registrationNumber: registrationNumber || null,
        profession: profession || null,
        state: state || null
      },
      note: 'For production use, implement cookie-based session scraping or contact AHPRA for data access agreement.'
    };

  } catch (err) {
    throw new Error(`AHPRA lookup failed: ${err.message}`);
  }
}

/**
 * Normalise AHPRA JSON response (if/when the API returns JSON).
 */
function normaliseAHPRAResponse(data) {
  if (!data || !data.practitioners) {
    return { results: [], count: 0 };
  }
  return {
    results: data.practitioners.map(p => ({
      name: p.name || null,
      registrationNumber: p.registrationNumber || null,
      profession: p.profession || null,
      registrationStatus: p.registrationStatus || null,   // Registered | Non-practising | Suspended | Cancelled
      registrationExpiry: p.expiryDate || null,
      principalState: p.principalPlaceOfPractice || null,
      conditions: p.conditions || [],
      endorsements: p.endorsements || []
    })),
    count: data.practitioners.length
  };
}

/**
 * MCP tool descriptor.
 */
const descriptor = {
  name: 'ahpra_lookup',
  description: 'Look up Australian health practitioner registration status via AHPRA. Returns registration status (Registered/Suspended/Cancelled), profession, expiry, and any conditions. Note: AHPRA currently requires browser-based verification; this tool returns the search URL and parameters for manual confirmation.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Practitioner full name or partial name' },
      registrationNumber: { type: 'string', description: 'AHPRA registration number e.g. MED0001234567' },
      profession: {
        type: 'string',
        description: 'Profession code: MED, NUR, PHY, PSY, DEN, PHR, OCC, OPT, ORT, POD, CHI, RAD, PAR, ATS, CMB'
      },
      state: { type: 'string', description: 'State filter: NSW, VIC, QLD, WA, SA, TAS, ACT, NT' }
    }
  },
  examples: [
    { name: 'John Smith', profession: 'MED' },
    { registrationNumber: 'MED0001234567' },
    { name: 'Sarah Jones', profession: 'NUR', state: 'NSW' }
  ],
  limitations: [
    'AHPRA has no public REST API — results require manual browser verification',
    'This tool returns the verification URL and parameters for use by a human or browser agent',
    'Rate limit: 1 request/sec to avoid IP blocks'
  ]
};

async function execute(params) {
  return await searchPractitioner(params);
}

module.exports = { searchPractitioner, descriptor, execute };
