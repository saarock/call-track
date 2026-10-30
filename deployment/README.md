# Private deployment

The production target is erp.royalcleaning.com.np on cPanel with SSH. A private company signing key has been generated outside the repository. Remote SSH account access has not been supplied, so production has not been deployed. Follow [the cPanel runbook](cpanel/README.md) for that hosting target; the Docker/VPS alternative follows below. Local preview APKs use a development signing certificate.

## Prerequisites

- A company-controlled Linux server with Docker Engine/Compose, enough CPU/RAM for Node and about 10 active agents, disk monitoring and security updates.
- A company-controlled domain with DNS pointing at that server. Allow inbound TCP80/443 (and UDP443 if desired); keep the API port and MongoDB private.
- Existing MongoDB Atlas database, least-privilege database user, network access rules and an agreed backup/restore policy.
- Random JWT secret, company SMTP credentials only if email delivery is required, authorized report recipients.
- Company release keystore and production APKs built against the final HTTPS API URL.
- A trusted administrator to manage employee accounts.

The application uses existing Atlas data. Back up the database before migrations or upgrading an existing deployment.

## Configure

From deployment/ on the private server:

```bash
cp .env.example .env
cp server.env.example server.env
chmod 600 .env server.env
mkdir -p private-releases
```

Edit the files privately. Set CALLTRACK_DOMAIN in .env. Set MONGODB_URI, a new JWT_SECRET, and CORS_ORIGINS=https://your-domain in server.env. The Compose configuration enables a single trusted reverse-proxy hop only inside its private Docker network. Do not expose api:5000 directly with that setting.

Copy the two company-signed production APKs and their generated release.json into deployment/private-releases. Do not put preview artifacts in a production release folder. The authenticated update route checks package/file metadata and SHA-256 before serving a release. Downloads use the logged-in employee session; the files are not public website assets.

Review database migration instructions in the main implementation report. Run migration preview/audit first if applicable; do not blindly rewrite old phone numbers or create unique indexes over unresolved duplicate data.

## Start and verify

From deployment/:

```bash
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=100 api
curl --fail https://YOUR-DOMAIN/api/health
```

Caddy obtains/manages TLS for the configured domain. Check browser login, both roles' access control, Socket.IO reconnects, APK update download, and a company test agent before distribution. The API container runs as an unprivileged user. Node dependencies are installed from lockfiles. The root .dockerignore excludes .env files, local data, node_modules, APKs and signing keys from build context.

For an upgrade, retain server.env, the database and the release signing identity. Back up, build the new image, run required audited migrations, then use docker compose up -d --build. Keep the previous images and a verified database restore point for rollback. Do not restore a live database without an explicit maintenance plan.

## Backups

Enable Atlas backup/PITR according to the chosen Atlas tier. A supplemental manual backup script is included. Install MongoDB Database Tools on a trusted backup host and create a private mongodump YAML config containing the connection URI, then:

```bash
chmod 600 /private/backup-mongodb.yaml
export MONGODUMP_CONFIG=/private/backup-mongodb.yaml
export CALLTRACK_BACKUP_DIR=/private/calltrack-backups
./backup-mongodb.sh
```

The script creates a compressed archive plus checksum under a private directory. Schedule via a company-managed cron/systemd timer; encrypt and copy archives to separate protected storage with retention. A successful backup is not a restore test: restore a copy into a separate database and verify logins, contacts, histories and report counts regularly. Never restore test data into the production database. Check archive logs and available disk.

## Costs and unavailable credentials

SIM calling continues to use the company's existing SIM/carrier plans. Optional hosting, Atlas backup, SMTP delivery, telephone trunks and recording storage are separate company/provider costs. Exact carrier charges, phone numbers, contractual recording permission, server size and storage retention depend on selected providers and workload; no paid resources are provisioned by these files.

Actual online deployment still needs the server/domain credentials and DNS, final HTTPS URL, approved database access rules and company signing key. No email delivery is claimed until SMTP and recipients are configured and a delivery has been verified.

