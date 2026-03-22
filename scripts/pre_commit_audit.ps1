param(
    [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$repo = (Resolve-Path $RepoRoot).Path
$tracked = @()

if (Test-Path (Join-Path $repo ".git")) {
    $tracked = git -C $repo ls-files
}

if (-not $tracked -or $tracked.Count -eq 0) {
    $tracked = Get-ChildItem -Path $repo -Recurse -File | ForEach-Object {
        $_.FullName.Substring($repo.Length + 1).Replace("\", "/")
    }
}

$skipPatterns = @(
    '^frontend/node_modules/',
    '^frontend/dist/',
    '^backend/.venv/',
    '^data/cache/',
    '^exports/',
    '^logs/',
    '/__pycache__/',
    '\.egg-info/'
)

$skipExtensions = @('.pdf', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2')

$textFiles = $tracked | Where-Object {
    $path = $_
    $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
    ($skipExtensions -notcontains $ext) -and -not ($skipPatterns | Where-Object { $path -match $_ })
}

$checks = @(
    @{ Name = 'OpenAI-style key'; Pattern = '(?i)\bsk-[A-Za-z0-9_-]{10,}\b' },
    @{ Name = 'Bearer token'; Pattern = '(?i)bearer\s+[A-Za-z0-9._-]{12,}' },
    @{ Name = 'Inline secret assignment'; Pattern = '(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*["''][^"'']{6,}["'']' }
)

$matches = @()

foreach ($relativePath in $textFiles) {
    $fullPath = Join-Path $repo $relativePath.Replace('/', '\')
    foreach ($check in $checks) {
        $result = Select-String -Path $fullPath -Pattern $check.Pattern -Encoding UTF8 -ErrorAction SilentlyContinue
        foreach ($hit in $result) {
            $matches += [PSCustomObject]@{
                Check = $check.Name
                File = $relativePath
                Line = $hit.LineNumber
                Text = $hit.Line.Trim()
            }
        }
    }
}

if (Test-Path (Join-Path $repo ".git")) {
    $mustIgnore = @(
        'data/ai_configs.json',
        'data/activity_log.jsonl',
        'data/cache',
        'exports/inspection',
        'logs/app.log',
        'frontend/node_modules',
        'frontend/dist'
    )

    foreach ($path in $mustIgnore) {
        $ignored = git -C $repo check-ignore $path 2>$null
        if (-not $ignored) {
            throw "Path should be ignored but is not: $path"
        }
    }
}

if ($matches.Count -gt 0) {
    Write-Host "Suspicious matches found:" -ForegroundColor Red
    $matches | Format-Table -AutoSize
    exit 1
}

Write-Host "Repository audit passed." -ForegroundColor Green
Write-Host "Checked files: $($textFiles.Count)"
