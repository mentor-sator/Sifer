Set-StrictMode -Version Latest

if (-not ('Sifer.CredentialStore' -as [type])) {
    Add-Type -Path (Join-Path $PSScriptRoot 'CredentialStore.cs')
}

function Set-SiferSecret {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Value
    )
    [Sifer.CredentialStore]::Write("sifer/$Name", $env:USERNAME, $Value)
}

function Get-SiferSecret {
    param([Parameter(Mandatory)][string]$Name)
    $value = [Sifer.CredentialStore]::Read("sifer/$Name")
    if ($null -eq $value) {
        throw "Secret sifer/$Name is not in the credential store."
    }
    $value
}

function Test-SiferSecret {
    param([Parameter(Mandatory)][string]$Name)
    $null -ne [Sifer.CredentialStore]::Read("sifer/$Name")
}

Export-ModuleMember -Function Set-SiferSecret, Get-SiferSecret, Test-SiferSecret
