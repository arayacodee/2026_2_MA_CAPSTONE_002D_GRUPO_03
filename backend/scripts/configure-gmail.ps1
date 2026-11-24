$ErrorActionPreference = 'Stop'
$configPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
$address = (Read-Host 'Correo Gmail remitente').Trim()
if ($address -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { throw 'Ingresa una dirección de correo válida.' }
$securePassword = Read-Host 'Contraseña de aplicación de Google (no la contraseña habitual)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $appPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) -replace '\s', ''
  if ($appPassword -notmatch '^[a-zA-Z0-9]{16}$') { throw 'La contraseña de aplicación debe tener 16 caracteres.' }
  $content = [IO.File]::ReadAllText($configPath)
  foreach ($entry in @(@('GMAIL_USER', $address), @('GMAIL_APP_PASSWORD', $appPassword), @('MAIL_MODE', 'gmail'))) {
    $pattern = '(?m)^' + $entry[0] + '=.*$'
    $line = $entry[0] + '=' + $entry[1]
    if ([regex]::IsMatch($content, $pattern)) { $content = [regex]::Replace($content, $pattern, $line) }
    else { $content += "`r`n" + $line + "`r`n" }
  }
  [IO.File]::WriteAllText($configPath, $content, (New-Object Text.UTF8Encoding($false)))
  Write-Output 'Gmail configurado en .env. No se enviaron correos. Ejecuta npm run gmail:verify y reinicia el backend.'
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $appPassword = $null
  $content = $null
}
