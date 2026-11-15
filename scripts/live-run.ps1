# Smoke test against the running local server: start a real collection for the last completed window and print results.
$base = 'http://127.0.0.1:5178'
$tok = (Invoke-RestMethod "$base/api/session").token
$w = Invoke-RestMethod "$base/api/window/default"
Write-Output "Window: $($w.from) -> $($w.to)"
$body = @{ window = @{ from = $w.from; to = $w.to }; trigger = 'manual' } | ConvertTo-Json
$r = Invoke-RestMethod -Method Post "$base/api/runs" -Headers @{ 'x-hcm-token' = $tok } -ContentType 'application/json' -Body $body
Write-Output "Run: $($r.runId)"
do {
  Start-Sleep -Seconds 5
  $m = Invoke-RestMethod "$base/api/runs/$($r.runId)"
  Write-Output ("  {0} total={1}" -f $m.status, $m.counts.total)
} while ($m.active)
$m.sources | ForEach-Object { "{0,-22} {1,-8} cand={2,-4} pages={3}/{4} limit={5}" -f $_.sourceName, $_.status, $_.candidates, $_.listingPagesVisited, $_.listingPageLimit, $_.limitReached }
"counts: " + ($m.counts | ConvertTo-Json -Compress)
"reconciliation: " + ($m.reconciliation | ConvertTo-Json -Compress)
"completeness: " + $m.completeness
