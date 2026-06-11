#!/bin/zsh
# Continuously grade + draft newly-scanned leads while a batch scan is running,
# so the dashboard's No-website count climbs steadily instead of in delayed jumps.
cd "$(dirname "$0")/.."
while pgrep -f 'tsx src/batch.ts' >/dev/null 2>&1; do
  npm run enrich >/dev/null 2>&1
  npm run draft  >/dev/null 2>&1
  sleep 120
done
