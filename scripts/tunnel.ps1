# Laptop -> homeserver tunnel for the Talk to Figma relay.
# Forwards localhost:3055 on the laptop (what the Figma plugin dials) to 127.0.0.1:3055 on the homeserver.
# Reconnects on drop; Ctrl+C to stop. Run: powershell -ExecutionPolicy Bypass -File tunnel.ps1

$Target = "jaypy@192.168.0.66"
$Port   = 3055

while ($true) {
    Write-Host "[$(Get-Date -Format HH:mm:ss)] tunnel localhost:$Port -> ${Target}:$Port"
    ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 `
        -L "${Port}:127.0.0.1:${Port}" $Target
    Write-Host "[$(Get-Date -Format HH:mm:ss)] tunnel closed (exit $LASTEXITCODE), retrying in 5s..."
    Start-Sleep -Seconds 5
}
