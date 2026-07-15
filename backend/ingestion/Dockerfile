FROM node:20-bookworm

RUN apt-get update \
  && apt-get install -y wget apt-transport-https software-properties-common \
  && wget -q https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb \
  && dpkg -i packages-microsoft-prod.deb \
  && apt-get update \
  && apt-get install -y powershell \
  && npm install -g bun@1.3.13 \
  && rm -rf /var/lib/apt/lists/*

RUN pwsh -NoProfile -NonInteractive -Command '\
  $ErrorActionPreference = "Stop"; \
  Set-PSRepository -Name PSGallery -InstallationPolicy Trusted; \
  Install-Module -Name ExchangeOnlineManagement -Scope AllUsers -Force -AllowClobber; \
  Install-Module -Name MicrosoftTeams -Scope AllUsers -Force -AllowClobber; \
  Import-Module ExchangeOnlineManagement; \
  Import-Module MicrosoftTeams; \
  Get-Command Connect-ExchangeOnline, Connect-MicrosoftTeams | Out-Null'

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile \
  && bun run --filter @mspbyte/drizzle build \
  && bun run --filter @mspbyte/drizzle-catalog build \
  && bun run --filter @mspbyte/shared build \
  && bun run --filter ingestion build

CMD ["bun", "run", "--filter", "ingestion", "start"]
