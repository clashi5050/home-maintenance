# qnap-export.ps1
# Copies the home-maintenance SQLite database and uploads from QNAP to this machine,
# verifies checksums, and prints a row-count summary so you know exactly what's coming over.
#
# Usage:
#   .\scripts\qnap-export.ps1 -QnapHost 192.168.1.x
#   .\scripts\qnap-export.ps1 -QnapHost 192.168.1.x -QnapUser admin -QnapPass yourpassword
#
# Output lands in  .\qnap-export\  (relative to the repo root).

param(
    [Parameter(Mandatory)]
    [string]$QnapHost,

    [string]$QnapUser = "",
    [string]$QnapPass = "",

    [string]$ExportDir = (Join-Path $PSScriptRoot "..\qnap-export")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SourceShare  = "\\$QnapHost\Public"
$SourceSubDir = "Containers\container-station-data\lib\docker\volumes\home-maintenance_home-maintenance-data\_data"
$SourcePath   = Join-Path $SourceShare $SourceSubDir
$ExportDir    = (Resolve-Path -LiteralPath (New-Item -ItemType Directory -Force -Path $ExportDir)).Path
$DbDest       = Join-Path $ExportDir "home-maintenance.db"
$ChecksumFile = Join-Path $ExportDir "checksums.txt"
$ReportFile   = Join-Path $ExportDir "export-report.txt"

Write-Host ""
Write-Host "=== QNAP Home Maintenance Export ===" -ForegroundColor Cyan
Write-Host "  Source : $SourcePath"
Write-Host "  Output : $ExportDir"
Write-Host ""

# ------------------------------------------------------------------
# 1. Mount the share if credentials were supplied
# ------------------------------------------------------------------
$mounted = $false
if ($QnapUser -ne "") {
    Write-Host "Mounting $SourceShare ..." -NoNewline
    $secPass = ConvertTo-SecureString $QnapPass -AsPlainText -Force
    $cred    = New-Object System.Management.Automation.PSCredential($QnapUser, $secPass)
    New-PSDrive -Name QNAP -PSProvider FileSystem -Root $SourceShare -Credential $cred -Persist:$false | Out-Null
    $mounted = $true
    Write-Host " done" -ForegroundColor Green
}

try {
    # ------------------------------------------------------------------
    # 2. Verify the source is reachable
    # ------------------------------------------------------------------
    if (-not (Test-Path $SourcePath)) {
        throw "Cannot reach $SourcePath — check the QNAP IP, share permissions, and that the volume folder exists."
    }
    Write-Host "Source reachable." -ForegroundColor Green

    # ------------------------------------------------------------------
    # 3. Copy the SQLite database (+ WAL/SHM if present)
    # ------------------------------------------------------------------
    Write-Host ""
    Write-Host "Copying database ..."
    foreach ($suffix in @("", "-wal", "-shm")) {
        $src = Join-Path $SourcePath "home-maintenance.db$suffix"
        if (Test-Path $src) {
            Copy-Item -LiteralPath $src -Destination "$DbDest$suffix" -Force
            Write-Host "  Copied home-maintenance.db$suffix" -ForegroundColor Green
        }
    }

    if (-not (Test-Path $DbDest)) {
        throw "home-maintenance.db not found at $SourcePath"
    }

    # ------------------------------------------------------------------
    # 4. Copy uploads / documents folder (if it exists)
    # ------------------------------------------------------------------
    $uploadSrc  = Join-Path $SourcePath "uploads"
    $uploadDest = Join-Path $ExportDir "uploads"
    $uploadsCopied = 0
    if (Test-Path $uploadSrc) {
        Write-Host ""
        Write-Host "Copying uploads folder ..."
        & robocopy $uploadSrc $uploadDest /E /NP /NFL /NDL /NC /NJS /NJH 2>&1 | Out-Null
        $uploadsCopied = (Get-ChildItem -Recurse -File $uploadDest -ErrorAction SilentlyContinue).Count
        Write-Host "  $uploadsCopied file(s) copied" -ForegroundColor Green
    } else {
        Write-Host "  No uploads folder found (skipped)" -ForegroundColor Yellow
    }

    # ------------------------------------------------------------------
    # 5. Checksums
    # ------------------------------------------------------------------
    Write-Host ""
    Write-Host "Generating checksums ..."
    $hashes = Get-ChildItem -Recurse -File $ExportDir | Where-Object { $_.Name -ne "checksums.txt" -and $_.Name -ne "export-report.txt" } |
        ForEach-Object { Get-FileHash $_.FullName -Algorithm SHA256 } |
        ForEach-Object { "$($_.Hash)  $(Resolve-Path -Relative $_.Path)" }
    $hashes | Set-Content $ChecksumFile
    Write-Host "  $($hashes.Count) file(s) hashed -> checksums.txt" -ForegroundColor Green

    # ------------------------------------------------------------------
    # 6. SQLite row counts (uses Node.js + better-sqlite3 from the project)
    # ------------------------------------------------------------------
    Write-Host ""
    Write-Host "Counting rows ..."
    $repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
    $nodeScript = @"
const Database = require('better-sqlite3');
const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
const counts = tables.map(t => {
  const n = db.prepare(\`SELECT COUNT(*) AS n FROM "\${t.name}"\`).get().n;
  return \`  \${t.name.padEnd(30)} \${n.toString().padStart(6)} rows\`;
});
console.log(counts.join('\n'));
db.close();
"@
    $rowCounts = node -e $nodeScript $DbDest 2>&1

    if ($LASTEXITCODE -eq 0) {
        Write-Host $rowCounts -ForegroundColor Cyan
    } else {
        Write-Host "  (could not count rows — better-sqlite3 unavailable: $rowCounts)" -ForegroundColor Yellow
        $rowCounts = "(row count unavailable)"
    }

    # ------------------------------------------------------------------
    # 7. Write report
    # ------------------------------------------------------------------
    $report = @"
Home Maintenance QNAP Export
Exported : $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Source   : $SourcePath
Output   : $ExportDir

--- Files ---
$(Get-ChildItem -Recurse -File $ExportDir | Where-Object Name -notin @("checksums.txt","export-report.txt") | ForEach-Object { "  $($_.Name)  ($([math]::Round($_.Length/1KB, 1)) KB)" })

--- Row counts ---
$rowCounts

--- Upload files ---
  $uploadsCopied file(s) copied

Checksums saved to checksums.txt.
Import the database into Azure or the new QNAP deployment by copying
home-maintenance.db into the app's DATA_DIR before first start.
"@
    $report | Set-Content $ReportFile
    Write-Host ""
    Write-Host "Report saved to export-report.txt"

    # ------------------------------------------------------------------
    # 8. Final summary
    # ------------------------------------------------------------------
    Write-Host ""
    Write-Host "=== Export complete ===" -ForegroundColor Green
    Write-Host "  Database  : $DbDest"
    Write-Host "  Checksums : $ChecksumFile"
    Write-Host "  Report    : $ReportFile"
    Write-Host ""
    Write-Host "Next step: copy home-maintenance.db into the app DATA_DIR before first start."
    Write-Host "(Azure: stop the Container App, copy to blob via azcopy, then restore on next start)"
    Write-Host "(QNAP : place in /share/Container/home-maintenance/data/ before running docker compose up)"
    Write-Host ""

} finally {
    if ($mounted) {
        Remove-PSDrive -Name QNAP -ErrorAction SilentlyContinue
    }
}
