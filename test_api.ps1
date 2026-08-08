$r = Invoke-WebRequest http://localhost:3000/api/schedule -UseBasicParsing
Write-Host "Status:" $r.StatusCode
Write-Host "Body:" $r.Content.Substring(0, [Math]::Min(400, $r.Content.Length))
