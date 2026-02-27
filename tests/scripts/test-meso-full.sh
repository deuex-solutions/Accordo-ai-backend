#!/bin/bash

TOKEN="603c50f564ad8c937a19bf445c66ce08"
BASE_URL="http://localhost:5002/api/vendor-chat"

echo "=== Testing Full MESO Flow (Running to Round 6) ==="

# Get current deal state
get_round() {
    curl -s "$BASE_URL/deal?uniqueToken=$TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['deal']['round'])"
}

send_message() {
    local msg=$1
    RESPONSE=$(curl -s -X POST "$BASE_URL/message" \
      -H "Content-Type: application/json" \
      -d "{\"uniqueToken\": \"$TOKEN\", \"content\": \"$msg\"}")
    echo $RESPONSE | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['vendorMessage']['id'])"
}

get_pm_response() {
    local msg_id=$1
    curl -s -X POST "$BASE_URL/pm-response" \
      -H "Content-Type: application/json" \
      -d "{\"uniqueToken\": \"$TOKEN\", \"vendorMessageId\": \"$msg_id\"}"
}

# Current round
CURRENT_ROUND=$(get_round)
echo "Starting at round: $CURRENT_ROUND"

# Run until we get MESO or round 7
while [ "$CURRENT_ROUND" -lt 7 ]; do
    echo ""
    echo "--- Round $((CURRENT_ROUND + 1)) ---"

    # Send vendor message
    MSG_ID=$(send_message "I can offer \$38,000 with Net 45 payment terms and delivery in 30 days.")
    echo "Vendor message ID: $MSG_ID"

    # Get PM response
    PM_RESPONSE=$(get_pm_response "$MSG_ID")

    echo "$PM_RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"Decision: {d['data']['decision']['action']}\")
print(f\"Round: {d['data']['deal']['round']}\")
if d['data'].get('meso'):
    meso = d['data']['meso']
    print(f\"*** MESO FOUND ***\")
    print(f\"MESO Success: {meso.get('success')}\")
    print(f\"MESO Phase: {meso.get('phase')}\")
    print(f\"Show Others: {meso.get('showOthers')}\")
    print(f\"Input Disabled: {meso.get('inputDisabled')}\")
    print(f\"Options: {len(meso.get('options', []))} options\")
    for opt in meso.get('options', []):
        print(f\"  - {opt['label']}: \${opt['offer'].get('total_price')}\")
else:
    print('No MESO in response')
"

    CURRENT_ROUND=$(get_round)

    # Check if deal ended
    STATUS=$(curl -s "$BASE_URL/deal?uniqueToken=$TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['deal']['status'])")
    if [ "$STATUS" != "NEGOTIATING" ]; then
        echo "Deal status changed to: $STATUS"
        break
    fi
done

echo ""
echo "=== Final State ==="
curl -s "$BASE_URL/deal?uniqueToken=$TOKEN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"Status: {d['data']['deal']['status']}\")
print(f\"Round: {d['data']['deal']['round']}\")
"
