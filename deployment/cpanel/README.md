# cPanel deployment for erp.royalcleaning.com.np

The domain resolves, and the owner confirmed cPanel with SSH. No SSH username, port, key path or authenticated hosting session was supplied. Nothing has been uploaded or changed on that host.

## Hosting prerequisites

Enable cPanel Application Manager / Setup Node.js App with Node22.13+ or Node24, Passenger, HTTPS and WebSocket support. SSH alone does not guarantee Node hosting. Ask the hosting provider to enable these if missing. Keep the application root outside public_html, and mount this Node application at the domain root. It serves the exported browser UI, /api and /socket.io through one existing Express/HTTP server.

Official references: [Node.js deployment](https://docs.cpanel.net/knowledge-base/web-services/how-to-install-a-node.js-application/), [Application Manager](https://docs.cpanel.net/cpanel/software/application-manager/), [Passenger restart](https://support.cpanel.net/hc/en-us/articles/1500002443862-How-to-restart-an-application-that-s-using-cPanel-s-Application-Manager).

## Prepare the release locally

From mobile/, export with the public API URL set to https://erp.royalcleaning.com.np/api:

```powershell
$env:EXPO_PUBLIC_API_URL='https://erp.royalcleaning.com.np/api'
node node_modules/expo/bin/cli export --platform web --max-workers 2 --output-dir dist-production
```

Then from the repository root:

```powershell
node deployment/cpanel/package-release.cjs
```

The timestamped deployment/artifacts/*.tar.gz includes only server source, dependency lockfiles, web assets, and company-signed APKs if built. It excludes .env secrets, signing files, dependencies, test fixtures and customer data.

## Install over SSH

Use the actual cPanel SSH username, hostname and port. Commands below use an existing application directory only after its contents have been checked and backed up; do not overwrite another ERP application.

```bash
mkdir -p ~/apps/royal-calltrack
cd ~/apps/royal-calltrack
tar -xzf ~/royal-calltrack-RELEASE.tar.gz
cd server
npm ci --omit=dev
cd ..
cp app.env.example .env
chmod 600 .env
```

Set MONGODB_URI and JWT_SECRET privately in .env or the cPanel application environment. Use the company's existing Atlas database and approved network access; no test data should be copied. Keep private-releases outside public_html. Do not copy the local signing.env or keystore to a public directory.

Register the application in cPanel: domain erp.royalcleaning.com.np, URL /, application root apps/royal-calltrack, production mode, startup app.js, Node22.13+/24. If your panel only accepts the default startup name, app.js is already supplied. The root CommonJS entry loads the existing ESM server package.

Back up MongoDB, then audit migration before applying:

```bash
cd ~/apps/royal-calltrack
# Run from root so dotenv reads the private root .env.
node server/scripts/migrate-call-center.js
node server/scripts/migrate-call-center.js --apply
mkdir -p tmp
touch tmp/restart.txt
curl --fail https://erp.royalcleaning.com.np/api/health
```

Use cPanel's Run NPM Install / restart controls if required by that host. Some CloudLinux panels provide an environment activation command; use the exact command shown by the panel before npm/node. Configure AutoSSL / HTTPS redirect through the hosting panel. Keep TRUST_PROXY_HOPS=0 until the provider confirms a single trusted proxy that strips untrusted forwarding headers.

Verify login, scoped supervisor access, Socket.IO reconnection, reports, private APK downloads and a company test agent. A successful local build does not verify this remote setup.

## Daily jobs

Passenger may stop idle applications. Add a cPanel cron every five minutes using the hosting panel's absolute Node path:

```bash
cd /home/YOUR_USER/apps/royal-calltrack && /ABSOLUTE/PATH/TO/node server/scripts/scheduled-maintenance.js >> /home/YOUR_USER/private/calltrack-maintenance.log 2>&1
```

This invokes idempotent daily reports and recording retention even when Passenger is idle. Live callback notifications still require the web process. SMTP must be configured and an actual delivery verified; no email was sent during automated tests.

## Private recording attachments

Set RECORDING_ENCRYPTION_KEY to a private 64-character hexadecimal key and RECORDING_DIRECTORY to a private writable directory outside public_html and the web folder. Keep a secure backup of both the key and encrypted files. Enable attachments in the administrator Recordings screen only after arranging authorized audio and consent. Automatic SIM audio capture and supervisor listening still require a supported manufacturer/provider integration.

The workstation key is stored in `D:\CompanySecrets\RoyalCleaning\recording-storage.env`; it is excluded from the deployment archive. Configure the production key through the hosting environment, never through EXPO_PUBLIC variables.

## Still required

SSH hostname, username, port and local key path or a logged-in hosting terminal; confirmation of Node22.13+/24 and WebSockets; existing site's backup/document root; Atlas server access rules. Do not paste private keys or passwords into chat.

