#!/bin/bash
# NorthWorld MCP Server — Smoke Tests
# Run after deployment: bash smoke-test.sh https://your-railway-url.up.railway.app
# Or locally: bash smoke-test.sh http://localhost:3000

BASE=${1:-http://localhost:3000}
API_KEY=${2:-}  # pass your API key as second arg if you have one

echo "===================================="
echo "NorthWorld MCP Smoke Tests"
echo "Target: $BASE"
echo "===================================="

PASS=0
FAIL=0

check() {
  local label="$1"
  local result="$2"
  local expect="$3"
  if echo "$result" | grep -q "$expect"; then
    echo "✅ PASS: $label"
    PASS=$((PASS+1))
  else
    echo "❌ FAIL: $label"
    echo "   Expected to find: $expect"
    echo "   Got: $(echo $result | head -c 200)"
    FAIL=$((FAIL+1))
  fi
}

# 1. Health check
echo ""
echo "--- 1. Health Check ---"
R=$(curl -s "$BASE/health")
check "health status ok" "$R" '"status":"ok"'
check "health lists tools" "$R" 'abr_lookup'

# 2. MCP manifest
echo ""
echo "--- 2. MCP Manifest ---"
R=$(curl -s "$BASE/mcp")
check "manifest has tools array" "$R" '"tools"'
check "manifest has abr_lookup" "$R" 'abr_lookup'
check "manifest has ahpra_lookup" "$R" 'ahpra_lookup'
check "manifest has ndis_provider_lookup" "$R" 'ndis_provider_lookup'
check "manifest has apollo_enrichment" "$R" 'apollo_enrichment'
check "manifest has freemium info" "$R" 'freemium'

# 3. Tool descriptors
echo ""
echo "--- 3. Tool Descriptors ---"
for tool in abr_lookup ahpra_lookup ndis_provider_lookup apollo_enrichment; do
  R=$(curl -s "$BASE/mcp/tools/$tool")
  check "descriptor: $tool" "$R" '"name"'
done

# 4. Auth — no key, should work (freemium)
echo ""
echo "--- 4. ABR Lookup (freemium, no key) ---"
R=$(curl -s -X POST "$BASE/tools/abr" \
  -H "Content-Type: application/json" \
  -d '{"abn":"51824753556"}')
# Could return result or error about ABR_GUID not configured
check "abr responded (any response)" "$R" "{"

# 5. Auth — invalid key should fail
echo ""
echo "--- 5. Invalid API Key ---"
R=$(curl -s -X POST "$BASE/tools/abr" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: totally-fake-key-12345" \
  -d '{"abn":"51824753556"}')
check "invalid key returns 401" "$R" 'invalid_api_key'

# 6. 404 handler
echo ""
echo "--- 6. 404 Handler ---"
R=$(curl -s "$BASE/nonexistent-route")
check "404 returns not_found" "$R" 'not_found'
check "404 lists available endpoints" "$R" 'available_endpoints'

# 7. MCP call endpoint
echo ""
echo "--- 7. MCP /mcp/call ---"
R=$(curl -s -X POST "$BASE/mcp/call" \
  -H "Content-Type: application/json" \
  -d '{"tool":"abr_lookup","params":{"abn":"51824753556"}}')
check "mcp/call responds" "$R" "{"

# 8. NDIS lookup (should gracefully handle API unavailability)
echo ""
echo "--- 8. NDIS Lookup (postcode 2000) ---"
R=$(curl -s -X POST "$BASE/tools/ndis" \
  -H "Content-Type: application/json" \
  -d '{"postcode":"2000","supportCategory":"07","limit":5}')
check "ndis responded" "$R" "{"

echo ""
echo "===================================="
echo "Results: $PASS passed, $FAIL failed"
echo "===================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
