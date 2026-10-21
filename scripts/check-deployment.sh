#!/usr/bin/env bash

# Kiem tra trang thai he thong UniForum
failed=0

check_url() {
    name="$1"
    url="$2"

    if curl -fsS --max-time 10 -o /dev/null "$url"; then
        echo "[OK] $name"
    else
        echo "[FAIL] $name"
        failed=1
    fi
}

echo "===== KIEM TRA UNIFORUM ====="

check_url "Website UniForum" "http://localhost:8080/health"
check_url "phpMyAdmin" "http://localhost:8081/"
check_url "Prometheus" "http://localhost:9090/-/healthy"
check_url "Grafana" "http://localhost:3001/api/health"

echo ""
echo "===== KIEM TRA BAO MAT NGINX ====="

headers=$(curl -fsSI --max-time 10 http://localhost:8080/ 2>/dev/null)

for header in X-Frame-Options X-Content-Type-Options Content-Security-Policy
do
    if echo "$headers" | grep -qi "^$header:"; then
        echo "[OK] $header"
    else
        echo "[FAIL] $header"
        failed=1
    fi
done

echo ""
if [ "$failed" -eq 0 ]; then
    echo "KET QUA: CAC KIEM TRA DEU DAT"
else
    echo "KET QUA: CO KIEM TRA CHUA DAT"
fi

exit "$failed"
