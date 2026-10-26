$ErrorActionPreference='Stop'
Push-Location "$PSScriptRoot/frontend"
try { npm ci; if($LASTEXITCODE){throw 'npm ci falhou'}; npx vite build --config vite.guardian-original.ts; if($LASTEXITCODE){throw 'Frontend falhou'} } finally { Pop-Location }
dotnet build "$PSScriptRoot/application/Center.csproj" -c Release -o "$PSScriptRoot/out"
if($LASTEXITCODE){throw 'Backend falhou; confira as dependências documentadas'}
New-Item -ItemType Directory -Force "$PSScriptRoot/out/guardian-web" | Out-Null
Copy-Item "$PSScriptRoot/frontend/dist-guardian-original/*" "$PSScriptRoot/out/guardian-web" -Recurse -Force
