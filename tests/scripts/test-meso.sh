#!/bin/bash

TOKEN="603c50f564ad8c937a19bf445c66ce08"
BASE_URL="http://localhost:5002/api/vendor-chat"

echo "=== Testing MESO Flow ==="

# Get current deal state
echo ""
echo "--- Current Deal State ---"
curl -s "$BASE_URL/deal?uniqueToken=$TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"Status: {d['data']['deal']['status']}, Round: {d['data']['deal']['round']}\")"

# Send a vendor message to advance the negotiation
echo ""
echo "--- Sending Vendor Message ---"
RESPONSE=$(curl -s -X POST "$BASE_URL/message" \
  -H "Content-Type: application/json" \
  -d "{\"uniqueToken\": \"$TOKEN\", \"content\": \"I can offer \$35,000 with Net 30 payment terms.\"}")

MSG_ID=$(echo $RESPONSE | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['vendorMessage']['id'])")
echo "Vendor message ID: $MSG_ID"

# Get PM response
echo ""
echo "--- Getting PM Response ---"
PM_RESPONSE=$(curl -s -X POST "$BASE_URL/pm-response" \
  -H "Content-Type: application/json" \
  -d "{\"uniqueToken\": \"$TOKEN\", \"vendorMessageId\": \"$MSG_ID\"}")

echo $PM_RESPONSE | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"Decision: {d['data']['decision']['action']}\")
print(f\"Round: {d['data']['deal']['round']}\")
if d['data'].get('meso'):
    meso = d['data']['meso']
    print(f\"MESO Success: {meso.get('success')}\")
    print(f\"MESO Phase: {meso.get('phase')}\")
    print(f\"Show Others: {meso.get('showOthers')}\")
    print(f\"Input Disabled: {meso.get('inputDisabled')}\")
    print(f\"Options: {len(meso.get('options', []))} options\")
else:
    print('No MESO in response')
"
