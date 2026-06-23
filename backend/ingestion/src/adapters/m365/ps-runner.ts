const DEFAULT_TIMEOUT_MS = 60_000;
const MAILBOX_FORWARDING_TIMEOUT_MS = 180_000;
const INBOX_RULES_TIMEOUT_MS = 120_000;
export const INBOX_RULES_BATCH_SIZE = 25;

async function runPwsh(
  script: string,
  params: Record<string, string> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const { spawn } = await import('child_process');

  const env: Record<string, string | undefined> = { ...process.env };
  for (const [key, value] of Object.entries(params)) {
    env[`PS_PARAM_${key.toUpperCase()}`] = value;
  }

  return new Promise((resolve, reject) => {
    let ps: ReturnType<typeof spawn>;
    try {
      ps = spawn('pwsh', ['-NonInteractive', '-NoProfile', '-Command', script], {
        env,
        timeout: timeoutMs
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reject(Object.assign(new Error(`Failed to spawn pwsh: ${msg}`), { failParent: true }));
      return;
    }

    let stdout = '';
    let stderr = '';

    ps.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    ps.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    ps.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(
          Object.assign(
            new Error('pwsh not found — install PowerShell 7+ to use Exchange/Teams facets'),
            { failParent: true }
          )
        );
      } else {
        reject(new Error(`PowerShell process error: ${err.message}`));
      }
    });

    ps.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (signal) {
        reject(
          Object.assign(
            new Error(`PowerShell killed by signal ${signal} (timeout after ${timeoutMs}ms)`),
            { retriable: true }
          )
        );
        return;
      }

      if (code !== 0) {
        reject(new Error(`PowerShell exited with code ${code}. stderr: ${stderr.slice(0, 500)}`));
        return;
      }

      try {
        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve(null);
          return;
        }
        const jsonStart = trimmed.search(/[{[]/);
        if (jsonStart < 0) {
          resolve(null);
          return;
        }
        const startChar = trimmed[jsonStart];
        const endChar = startChar === '{' ? '}' : ']';
        const jsonEnd = trimmed.lastIndexOf(endChar);
        resolve(JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)));
      } catch {
        reject(new Error(`Failed to parse PowerShell JSON output: ${stdout.slice(0, 500)}`));
      }
    });
  });
}

export async function runExchangeOnlineFull(
  clientId: string,
  certPem: string,
  organization: string
): Promise<unknown> {
  const script = `
$ErrorActionPreference = 'Stop'

$certPath = [System.IO.Path]::GetTempFileName() + '.pem'
[System.IO.File]::WriteAllText($certPath, $env:PS_PARAM_CERT_PEM)

try {
  $pemContent = Get-Content $certPath -Raw
  $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem(
    $pemContent,
    $pemContent
  )

  Connect-ExchangeOnline \`
    -AppId $env:PS_PARAM_CLIENT_ID \`
    -Certificate $cert \`
    -Organization $env:PS_PARAM_ORGANIZATION \`
    -ShowBanner:$false

  $result = [ordered]@{}

  try {
    $orgConfig = Get-OrganizationConfig
    $result.OrgConfig = @{ RejectDirectSend = [bool]$orgConfig.RejectDirectSend }
  } catch { $result.OrgConfig = $null }

  try {
    $spamFilter = Get-HostedOutboundSpamFilterPolicy -Identity Default
    $result.AutoForwardingMode = [string]$spamFilter.AutoForwardingMode
  } catch { $result.AutoForwardingMode = $null }

  try {
    $result.AuthPolicies = @(Get-AuthenticationPolicy | Select-Object Name, AllowBasicAuthSmtp)
  } catch { $result.AuthPolicies = @() }

  $result | ConvertTo-Json -Depth 10
} finally {
  if (Test-Path $certPath) { Remove-Item $certPath -Force }
  try { Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue } catch {}
}
`.trim();

  return runPwsh(script, { CLIENT_ID: clientId, CERT_PEM: certPem, ORGANIZATION: organization });
}

export async function runExchangeOnlineDomainConfig(
  clientId: string,
  certPem: string,
  organization: string
): Promise<unknown> {
  const script = `
$ErrorActionPreference = 'Stop'

$certPath = [System.IO.Path]::GetTempFileName() + '.pem'
[System.IO.File]::WriteAllText($certPath, $env:PS_PARAM_CERT_PEM)

try {
  $pemContent = Get-Content $certPath -Raw
  $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem(
    $pemContent,
    $pemContent
  )

  Connect-ExchangeOnline \`
    -AppId $env:PS_PARAM_CLIENT_ID \`
    -Certificate $cert \`
    -Organization $env:PS_PARAM_ORGANIZATION \`
    -ShowBanner:$false

  $result = [ordered]@{}

  try {
    $result.AcceptedDomains = @(Get-AcceptedDomain | Select-Object DomainName, Default)
  } catch { $result.AcceptedDomains = @() }

  try {
    $result.DkimConfigs = @(Get-DkimSigningConfig | Select-Object Domain, Enabled, Selector1PublicKey, Selector2PublicKey)
  } catch { $result.DkimConfigs = @() }

  $result | ConvertTo-Json -Depth 10
} finally {
  if (Test-Path $certPath) { Remove-Item $certPath -Force }
  try { Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue } catch {}
}
`.trim();

  return runPwsh(script, { CLIENT_ID: clientId, CERT_PEM: certPem, ORGANIZATION: organization });
}

export async function runMicrosoftTeams(
  clientId: string,
  certPem: string,
  tenantId: string
): Promise<unknown> {
  const script = `
$ErrorActionPreference = 'Stop'

$certPath = [System.IO.Path]::GetTempFileName() + '.pem'
[System.IO.File]::WriteAllText($certPath, $env:PS_PARAM_CERT_PEM)

try {
  $pemContent = Get-Content $certPath -Raw
  $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem(
    $pemContent,
    $pemContent
  )

  Connect-MicrosoftTeams \`
    -ApplicationId $env:PS_PARAM_CLIENT_ID \`
    -Certificate $cert \`
    -TenantId $env:PS_PARAM_TENANT_ID | Out-Null

  $result = [ordered]@{}

  try {
    $result.MeetingPolicy = Get-CsTeamsMeetingPolicy -Identity Global |
      Select-Object AllowAnonymousUsersToJoinMeeting,
                    AllowExternalParticipantGiveRequestControl,
                    AllowPSTNUsersToBypassLobby,
                    AutoAdmittedUsers
  } catch { $result.MeetingPolicy = $null }

  try {
    $fed = Get-CsTenantFederationConfiguration
    $result.FederationConfig = @{
      AllowFederatedUsers  = [bool]$fed.AllowFederatedUsers
      AllowPublicUsers     = [bool]$fed.AllowPublicUsers
      AllowTeamsConsumer   = [bool]$fed.AllowTeamsConsumer
      AllowedDomains       = @($fed.AllowedDomains.AllowedDomain | ForEach-Object { $_.Domain } | Where-Object { $_ -ne $null })
    }
  } catch { $result.FederationConfig = $null }

  $result | ConvertTo-Json -Depth 10
} finally {
  if (Test-Path $certPath) { Remove-Item $certPath -Force }
  try { Disconnect-MicrosoftTeams -ErrorAction SilentlyContinue } catch {}
}
`.trim();

  return runPwsh(script, { CLIENT_ID: clientId, CERT_PEM: certPem, TENANT_ID: tenantId });
}

export async function runMailboxForwardingFull(
  clientId: string,
  certPem: string,
  organization: string
): Promise<unknown> {
  const script = `
$ErrorActionPreference = 'Stop'

$certPath = [System.IO.Path]::GetTempFileName() + '.pem'
[System.IO.File]::WriteAllText($certPath, $env:PS_PARAM_CERT_PEM)

try {
  $pemContent = Get-Content $certPath -Raw
  $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem(
    $pemContent,
    $pemContent
  )

  Connect-ExchangeOnline \`
    -AppId $env:PS_PARAM_CLIENT_ID \`
    -Certificate $cert \`
    -Organization $env:PS_PARAM_ORGANIZATION \`
    -ShowBanner:$false

  $result = [ordered]@{}

  try {
    $result.ForwardingMailboxes = @(
      Get-EXOMailbox -ResultSize Unlimited -PropertySets Minimum -Properties ForwardingAddress,ForwardingSmtpAddress,DeliverToMailboxAndForward |
      Where-Object { $_.ForwardingAddress -ne $null -or $_.ForwardingSmtpAddress -ne $null } |
      Select-Object UserPrincipalName, ForwardingAddress, ForwardingSmtpAddress, DeliverToMailboxAndForward
    )
  } catch { $result.ForwardingMailboxes = @() }

  $result | ConvertTo-Json -Depth 10
} finally {
  if (Test-Path $certPath) { Remove-Item $certPath -Force }
  try { Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue } catch {}
}
`.trim();

  return runPwsh(
    script,
    { CLIENT_ID: clientId, CERT_PEM: certPem, ORGANIZATION: organization },
    MAILBOX_FORWARDING_TIMEOUT_MS
  );
}

export async function runInboxRules(
  clientId: string,
  certPem: string,
  organization: string,
  upns: string[]
): Promise<unknown> {
  const script = `
$ErrorActionPreference = 'Stop'
$WarningPreference = 'SilentlyContinue'

$certPath = [System.IO.Path]::GetTempFileName() + '.pem'
[System.IO.File]::WriteAllText($certPath, $env:PS_PARAM_CERT_PEM)

try {
  $pemContent = Get-Content $certPath -Raw
  $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem(
    $pemContent,
    $pemContent
  )

  Connect-ExchangeOnline \`
    -AppId $env:PS_PARAM_CLIENT_ID \`
    -Certificate $cert \`
    -Organization $env:PS_PARAM_ORGANIZATION \`
    -ShowBanner:$false

  $upnList = $env:PS_PARAM_UPNS | ConvertFrom-Json
  $allRules = [System.Collections.Generic.List[object]]::new()
  $suspiciousFolders = @('Deleted Items', 'Junk Email', 'RSS Feeds', 'Trash')

  foreach ($upn in $upnList) {
    try {
      $rules = Get-InboxRule -Mailbox $upn -ErrorAction SilentlyContinue
      foreach ($rule in $rules) {
        $suspicious = $false
        if ($rule.DeleteMessage -eq $true) { $suspicious = $true }
        if ($rule.ForwardTo -and $rule.ForwardTo.Count -gt 0) { $suspicious = $true }
        if ($rule.ForwardAsAttachmentTo -and $rule.ForwardAsAttachmentTo.Count -gt 0) { $suspicious = $true }
        if ($rule.RedirectTo -and $rule.RedirectTo.Count -gt 0) { $suspicious = $true }
        if ($rule.MoveToFolder -and $suspiciousFolders -contains $rule.MoveToFolder) { $suspicious = $true }

        if ($suspicious) {
          $allRules.Add([ordered]@{
            Name = [string]$rule.Name
            Identity = [string]$rule.Identity
            MailboxUserPrincipalName = $upn
            Enabled = if ($null -ne $rule.Enabled) { [bool]$rule.Enabled } else { $null }
            DeleteMessage = if ($null -ne $rule.DeleteMessage) { [bool]$rule.DeleteMessage } else { $null }
            MoveToFolder = if ($rule.MoveToFolder) { [string]$rule.MoveToFolder } else { $null }
            ForwardTo = @($rule.ForwardTo | ForEach-Object { [string]$_ })
            ForwardAsAttachmentTo = @($rule.ForwardAsAttachmentTo | ForEach-Object { [string]$_ })
            RedirectTo = @($rule.RedirectTo | ForEach-Object { [string]$_ })
            MarkAsRead = if ($null -ne $rule.MarkAsRead) { [bool]$rule.MarkAsRead } else { $null }
            SubjectContainsWords = @($rule.SubjectContainsWords)
          })
        }
      }
    } catch { continue }
  }

  @{ InboxRules = $allRules } | ConvertTo-Json -Depth 10
} finally {
  if (Test-Path $certPath) { Remove-Item $certPath -Force }
  try { Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue } catch {}
}
`.trim();

  return runPwsh(
    script,
    {
      CLIENT_ID: clientId,
      CERT_PEM: certPem,
      ORGANIZATION: organization,
      UPNS: JSON.stringify(upns)
    },
    INBOX_RULES_TIMEOUT_MS
  );
}
