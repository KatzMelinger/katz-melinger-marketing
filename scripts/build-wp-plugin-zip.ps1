# Build wp-plugin/km-autopilot.zip for WordPress "Upload Plugin".
#
# Why this exists: Windows PowerShell's Compress-Archive writes zip entries with
# BACKSLASH separators (e.g. "km-autopilot\km-autopilot.php"). WordPress runs on
# Linux and expects forward slashes, so a Compress-Archive zip fails to install
# ("plugin file does not exist" / "No valid plugins were found"). This script
# uses the .NET ZipArchive API with an explicit forward-slash entry path so the
# package installs cleanly.
#
# Run from anywhere:  powershell -File scripts/build-wp-plugin-zip.ps1
# Re-run any time public/wp-plugin/km-autopilot.php changes, then re-upload the
# zip (or overwrite the single .php on the site directly).
#
# Optional -FolderName installs the plugin under a different directory, e.g. to
# sidestep a stuck "km-autopilot" folder you can't delete:
#   powershell -File scripts/build-wp-plugin-zip.ps1 -FolderName km-autopilot-v2

param(
    [string]$FolderName = "km-autopilot"
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $repo "public\wp-plugin"
$php  = Join-Path $src "km-autopilot.php"
$zip  = Join-Path $src "$FolderName.zip"

if (-not (Test-Path $php)) {
    throw "Plugin source not found: $php"
}
if (Test-Path $zip) {
    Remove-Item $zip -Force
}

Add-Type -AssemblyName System.IO.Compression          # ZipArchiveMode enum
Add-Type -AssemblyName System.IO.Compression.FileSystem # ZipFile / ZipFileExtensions
$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    # Explicit forward-slash entry path → installs on Linux/WordPress.
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive, $php, "$FolderName/km-autopilot.php"
    ) | Out-Null
}
finally {
    $archive.Dispose()
}

# Read the plugin version for confirmation.
$version = (Select-String -Path $php -Pattern "Version:\s*([0-9.]+)" |
    Select-Object -First 1).Matches.Groups[1].Value

Write-Output "Built: $zip (v$version)"
Write-Output "Entries:"
[System.IO.Compression.ZipFile]::OpenRead($zip).Entries | ForEach-Object { "  " + $_.FullName }
