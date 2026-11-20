param(
    [string]$BaseUrl = "http://10.200.8.204:9090/v1",
    [string]$Model = "Hy-MT2-1.8B-FP8",
    [int]$MaxTokens = 64
)

$ErrorActionPreference = "Stop"

function Get-ApiKey {
    if ($env:HYMT2_API_KEY) {
        return $env:HYMT2_API_KEY
    }
    $secure = Read-Host "请输入 API Key（输入不回显；也可提前设置环境变量 HYMT2_API_KEY）" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

$key = (Get-ApiKey).Trim()
if ($key -match '^Bearer\s+') {
    $key = $key -replace '^Bearer\s+', ''
}
if ([string]::IsNullOrWhiteSpace($key)) {
    throw "API Key 为空。"
}

$endpoint = $BaseUrl.Trim().TrimEnd('/')
if ($endpoint -notmatch '/chat/completions$') {
    if ($endpoint -match '/v1$') {
        $endpoint += '/chat/completions'
    }
    else {
        $endpoint += '/v1/chat/completions'
    }
}

$prompt = "将以下文本翻译为中文，注意只需要输出翻译后的结果，不要额外解释：`n`nHello"
$payload = @{
    model       = $Model
    messages    = @(@{ role = 'user'; content = $prompt })
    temperature = 0.7
    top_p       = 0.6
    max_tokens  = $MaxTokens
    stream      = $false
} | ConvertTo-Json -Depth 10

$bodyFile = Join-Path $env:TEMP ("hymt2-body-" + [guid]::NewGuid().ToString("N") + ".json")
$respFile = Join-Path $env:TEMP ("hymt2-resp-" + [guid]::NewGuid().ToString("N") + ".json")

try {
    [IO.File]::WriteAllText($bodyFile, $payload, [Text.UTF8Encoding]::new($false))

    Write-Host "Endpoint : $endpoint"
    Write-Host "Model    : $Model"
    Write-Host "Key      : 已读取（长度 $($key.Length)，不显示内容）"
    Write-Host ""

    $curlArgs = @(
        '-sS', '--max-time', '180',
        '-o', $respFile,
        '-w', 'HTTP %{http_code} | %{time_total}s',
        '-H', "Authorization: Bearer $key",
        '-H', 'Content-Type: application/json',
        '--data-binary', "@$bodyFile",
        $endpoint
    )

    & curl.exe @curlArgs
    $exitCode = $LASTEXITCODE

    Write-Host ""
    Write-Host "curl exit code: $exitCode"
    if (Test-Path $respFile) {
        Write-Host "Response body:"
        Get-Content $respFile -Raw
    }
}
finally {
    Remove-Item $bodyFile, $respFile -Force -ErrorAction SilentlyContinue
}
