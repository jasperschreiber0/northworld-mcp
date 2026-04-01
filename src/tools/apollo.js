/**
 * Apollo.io enrichment passthrough tool.
 *
 * Wraps Lead Jen's Apollo logic for use as an MCP tool.
 * Allows other agents to enrich leads via the centralised MCP server
 * rather than each holding their own Apollo key.
 *
 * Operations:
 *   - enrich: Reveal email/phone for a known person by Apollo ID or LinkedIn URL
 *   - search: Search people by title, location, industry, company size
 *   - company: Look up company details by domain or name
 */

const fetch = require('node-fetch');

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const APOLLO_BASE = 'https://api.apollo.io/api/v1';

function apolloHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': APOLLO_API_KEY
  };
}

/**
 * Enrich a person by Apollo ID or LinkedIn URL.
 */
async function enrichPerson({ apolloId, linkedinUrl }) {
  if (!APOLLO_API_KEY) throw new Error('APOLLO_API_KEY not configured');
  if (!apolloId && !linkedinUrl) throw new Error('Provide apolloId or linkedinUrl');

  const detail = apolloId ? { id: apolloId } : { linkedin_url: linkedinUrl };
  const res = await fetch(`${APOLLO_BASE}/people/bulk_match`, {
    method: 'POST',
    headers: apolloHeaders(),
    body: JSON.stringify({ details: [detail], reveal_personal_emails: true })
  });
  const data = await res.json();
  const match = data.matches && data.matches[0];
  if (!match) return { found: false };

  return {
    found: true,
    apolloId: match.id,
    name: match.name,
    email: match.email,
    phone: match.phone_numbers && match.phone_numbers[0] ? match.phone_numbers[0].raw_number : null,
    title: match.title,
    company: match.organization ? match.organization.name : null,
    industry: match.organization ? match.organization.industry : null,
    linkedin: match.linkedin_url,
    location: match.city ? `${match.city}${match.state ? ', ' + match.state : ''}` : null,
    seniority: match.seniority
  };
}

/**
 * Search people by filters.
 */
async function searchPeople({
  titles = [],
  locations = ['Australia'],
  industries = [],
  companySizes = ['1,10', '11,20', '21,50', '51,200'],
  keywords = [],
  page = 1,
  perPage = 25
}) {
  if (!APOLLO_API_KEY) throw new Error('APOLLO_API_KEY not configured');

  const body = {
    per_page: Math.min(perPage, 100),
    page,
    person_locations: locations,
    contact_email_status: ['verified', 'likely to engage'],
    prospected_by_current_team: ['no'],
    num_employees_ranges: companySizes
  };

  if (titles.length > 0) body.person_titles = titles;
  if (industries.length > 0) body.organization_industry_tag_ids = industries;
  if (keywords.length > 0) body.q_keywords = keywords.join(' ');

  const res = await fetch(`${APOLLO_BASE}/mixed_people/api_search`, {
    method: 'POST',
    headers: apolloHeaders(),
    body: JSON.stringify(body)
  });
  const data = await res.json();
  const people = data.people || [];

  return {
    count: people.length,
    totalCount: data.pagination ? data.pagination.total_entries : null,
    page,
    people: people.map(p => ({
      apolloId: p.id,
      name: p.name,
      title: p.title,
      company: p.organization ? p.organization.name : null,
      industry: p.organization ? p.organization.industry : null,
      location: p.city ? `${p.city}${p.state ? ', ' + p.state : ''}` : 'Australia',
      linkedin: p.linkedin_url,
      seniority: p.seniority,
      headcount: p.organization ? p.organization.estimated_num_employees : null
    }))
  };
}

/**
 * Look up company by domain.
 */
async function lookupCompany({ domain, name }) {
  if (!APOLLO_API_KEY) throw new Error('APOLLO_API_KEY not configured');
  if (!domain && !name) throw new Error('Provide domain or name');

  const body = {};
  if (domain) body.domain = domain;
  if (name) body.name = name;

  const res = await fetch(`${APOLLO_BASE}/organizations/enrich`, {
    method: 'POST',
    headers: apolloHeaders(),
    body: JSON.stringify(body)
  });
  const data = await res.json();
  const org = data.organization;
  if (!org) return { found: false };

  return {
    found: true,
    name: org.name,
    domain: org.primary_domain,
    industry: org.industry,
    headcount: org.estimated_num_employees,
    headcountGrowth12mo: org.organization_headcount_twelve_month_growth,
    revenue: org.annual_revenue_printed,
    founded: org.founded_year,
    location: org.city ? `${org.city}${org.state ? ', ' + org.state : ''}` : null,
    country: org.country,
    linkedin: org.linkedin_url,
    description: org.short_description,
    keywords: org.keywords || []
  };
}

/**
 * MCP tool descriptor.
 */
const descriptor = {
  name: 'apollo_enrichment',
  description: 'Enrich leads and companies via Apollo.io. Search people by title/location/industry, reveal contact details for known Apollo IDs or LinkedIn URLs, and look up company data by domain.',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['enrich_person', 'search_people', 'lookup_company'],
        description: 'Operation to perform'
      },
      apolloId: { type: 'string', description: 'Apollo person ID (for enrich_person)' },
      linkedinUrl: { type: 'string', description: 'LinkedIn profile URL (for enrich_person)' },
      titles: { type: 'array', items: { type: 'string' }, description: 'Job titles to filter by (for search_people)' },
      locations: { type: 'array', items: { type: 'string' }, description: 'Locations e.g. ["Australia", "Sydney"]' },
      industries: { type: 'array', items: { type: 'string' }, description: 'Industry filters' },
      companySizes: { type: 'array', items: { type: 'string' }, description: 'Employee ranges e.g. ["1,10","11,20"]' },
      domain: { type: 'string', description: 'Company domain (for lookup_company)' },
      name: { type: 'string', description: 'Company name (for lookup_company)' },
      page: { type: 'number', description: 'Page number for search (default 1)' },
      perPage: { type: 'number', description: 'Results per page (max 100, default 25)' }
    },
    required: ['operation']
  },
  examples: [
    { operation: 'enrich_person', linkedinUrl: 'https://linkedin.com/in/example' },
    { operation: 'search_people', titles: ['CEO', 'Founder'], locations: ['Sydney, NSW'] },
    { operation: 'lookup_company', domain: 'northworld.com.au' }
  ]
};

async function execute(params) {
  const { operation, ...rest } = params;
  if (operation === 'enrich_person') return await enrichPerson(rest);
  if (operation === 'search_people') return await searchPeople(rest);
  if (operation === 'lookup_company') return await lookupCompany(rest);
  throw new Error(`Unknown operation: ${operation}. Use: enrich_person, search_people, lookup_company`);
}

module.exports = { enrichPerson, searchPeople, lookupCompany, descriptor, execute };
