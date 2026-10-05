$ErrorActionPreference = 'Stop'
$message = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($message)) { exit 0 }
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voice.Speak($message)
} finally {
    $voice.Dispose()
}
