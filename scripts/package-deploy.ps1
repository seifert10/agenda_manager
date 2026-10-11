$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$deployRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$deployArchivePath = [System.IO.Path]::GetFullPath((Join-Path $deployRoot 'deploy-package.zip'))
if (-not $deployArchivePath.StartsWith($deployRoot + [System.IO.Path]::DirectorySeparatorChar)) { throw 'Destino fora do projeto.' }
if (Test-Path -LiteralPath $deployArchivePath) { Remove-Item -LiteralPath $deployArchivePath }
$deployFiles = @('.gitignore','.node-version','.env.example','package.json','package-lock.json','README.md','render.yaml','index.html','vite.config.ts','tsconfig.json','tsconfig.node.json','tailwind.config.js','postcss.config.js') | ForEach-Object { Get-Item -LiteralPath (Join-Path $deployRoot $_) }
foreach ($deployDirectory in @('src','server','shared','public','scripts','docs')) {
    $deployFiles += Get-ChildItem -LiteralPath (Join-Path $deployRoot $deployDirectory) -Recurse -File
}
$deployArchive = [System.IO.Compression.ZipFile]::Open($deployArchivePath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($deployFile in $deployFiles) {
        $deployEntry = [System.IO.Path]::GetRelativePath($deployRoot,$deployFile.FullName).Replace('\','/')
        if ($deployFile.Name -match '^\.env($|\.)' -and $deployFile.Name -ne '.env.example') { throw 'Arquivo de segredo encontrado na seleção.' }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($deployArchive,$deployFile.FullName,$deployEntry,[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $deployArchive.Dispose() }
Write-Output "Pacote criado: $deployArchivePath"
