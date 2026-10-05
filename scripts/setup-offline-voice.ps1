param([string]$PythonExe = '')
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$environment = Join-Path $project '.venv'
$models = Join-Path $project '.local-models'
$model = Join-Path $models 'vosk-model-small-en-us-0.15'
if ($PythonExe) {
    & $PythonExe -m venv $environment
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3.12 -m venv $environment
} else {
    & python -m venv $environment
}
if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 is required to set up offline voice.' }
$venvPython = Join-Path $environment 'Scripts\python.exe'
& $venvPython -m pip install --disable-pip-version-check 'vosk==0.3.45' 'sounddevice==0.5.3'
if ($LASTEXITCODE -ne 0) { throw 'Could not install the offline voice packages.' }
New-Item -ItemType Directory -Path $models -Force | Out-Null
if (-not (Test-Path -LiteralPath $model)) {
    $archive = Join-Path $models 'vosk-en-us.zip'
    Invoke-WebRequest -Uri 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip' -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $models -Force
    Remove-Item -LiteralPath $archive -Force
}
& $venvPython (Join-Path $PSScriptRoot 'offline_voice.py') status $model
if ($LASTEXITCODE -ne 0) { throw 'Offline voice is installed, but no working microphone was found.' }
Write-Host 'Offline voice is ready. Launch scripts\desktop_assistant.py with .venv\Scripts\python.exe, or start the web app.'
