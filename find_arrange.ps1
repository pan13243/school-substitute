$content = Get-Content -Path 'C:\Users\HUA WEI\Downloads\school-substitute\functions\api\[[path]].js' -Raw -Encoding UTF8
$lines = $content -split "`n"
for ($i = 0; $i -lt $lines.Length; $i++) {
    if ($lines[$i] -match '安排|记录已生成') {
        Write-Host "Line $($i+1): $($lines[$i].Trim().Substring(0, [Math]::Min(120, $lines[$i].Trim().Length)))"
    }
}
