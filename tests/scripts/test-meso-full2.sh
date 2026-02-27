#!/bin/bash
# Test MESO with a fresh deal and higher prices to avoid early acceptance

TOKEN="a452b4d8e3084c7c791d90790b92edc0"
BASE_URL="http://localhost:5002/api/vendor-chat"

echo "=== Testing Full MESO Flow (Running to Round 6) ==="
echo "Using token: $TOKEN"

get_deal() {
    curl -s "$BASE_URL/deal?uniqueToken=$TOKEN"
}

get_round() {
    get_deal | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['deal']['round'])"
}

get_status() {
    get_deal | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['deal']['status'])"
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
ROUND_NUM=$CURRENT_ROUND
PRICES=("95000" "90000" "85000" "80000" "75000" "70000" "65000")

while [ "$ROUND_NUM" -lt 7 ]; do
    echo ""
    echo "--- Round $((ROUND_NUM + 1)) ---"

    # Use different high prices each round to avoid early acceptance
    PRICE=${PRICES[$ROUND_NUM]}
    MSG="I can offer \$$PRICE with Net 30 payment terms and delivery in 45 days."
    echo "Sending: $MSG"

    # Send vendor message
    MSG_ID=$(send_message "$MSG")
    echo "Vendor message ID: $MSG_ID"

    # Get PM response
    PM_RESPONSE=$(get_pm_response "$MSG_ID")

    echo "$PM_RESPONSE" | python3 -c "
import sys, json
try:
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
except Exception as e:
    print(f'Error parsing response: {e}')
"

    ROUND_NUM=$(get_round)
    STATUS=$(get_status)

    if [ "$STATUS" != "NEGOTIATING" ]; then
        echo "Deal status changed to: $STATUS"
        break
    fi
done

echo ""
echo "=== Final State ==="
get_deal | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"Status: {d['data']['deal']['status']}\")
print(f\"Round: {d['data']['deal']['round']}\")
"
