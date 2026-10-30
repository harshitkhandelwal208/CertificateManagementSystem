# Neon and Render deployment plan

This deployment uses a single Render Docker web service and an external Neon PostgreSQL database. PostgreSQL is the source of truth for records and runtime files; `/app/data` is disposable working space. The deployment does not require a persistent Render disk.

## 1. Prepare Neon

1. Create a Neon project near the Render service region and use a dedicated production branch/database. Use a separate branch for staging and integration tests.
2. Copy the PostgreSQL connection URI from Neon's Connect dialog. Select the pooled connection string (`-pooler` in the hostname) and keep TLS enabled (`sslmode=require`). Store it in Render as `DATABASE_URL`.
3. Use a database role that can create the application's schema on the first launch. Keep the credentials private. Avoid sharing the production connection URI in chat, logs, or source files.
4. Confirm your Neon plan has sufficient storage and backup/restore coverage for signed PDFs, detached signatures, and template files as well as records. Configure monitoring for database capacity and connection errors.

The application uses small client connection pools. PDF files are stored in the `runtime_files` table together with template PDFs and layout files, so database capacity grows with issued certificates. The first startup creates missing schema objects. It does not import the deleted SQLite test data.

Neon documents pooled connections in its [connection pooling guide](https://neon.com/docs/connect/connection-pooling).

## 2. Provision signing material

Use the organization's existing valid signing PFX and public root PEM. The signing certificate must contain its private key and chain correctly to that root. If no CA exists, generate one with the CA tool described in the [README](../README.md), then move the root PFX offline.

Encode the two runtime files as single-line base64 strings on a trusted machine. For example, on Linux:

```bash
base64 -w 0 data/ca/signing.pfx > signing-pfx.base64
base64 -w 0 data/ca/root-ca.pem > root-ca-pem.base64
```

Treat `signing-pfx.base64` as a secret. Upload its contents to Render's `SIGNING_PFX_BASE64` environment value; upload the public root value to `TRUSTED_ROOT_PEM_BASE64`. Set `Signing__PfxPassword` to the PFX password. Do not put the root CA private key on Render. Do not regenerate the CA on each deployment: existing certificates must remain verifiable across restarts and releases.

Startup decodes these values into owner-readable files beneath `/app/data/ca`, checks the deployment settings, and initializes the database. Invalid configuration fails startup before public readiness.

## 3. Configure Render

1. Connect the GitHub repository in Render and create a Blueprint from [`render.yaml`](../render.yaml), or create a Docker web service using the root Dockerfile.
2. Select the service region close to Neon. The Blueprint starts with the free plan; measure memory usage and request duration during issuance before selecting the production plan.
3. Provide `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `Signing__PfxPassword`, `SIGNING_PFX_BASE64`, and `TRUSTED_ROOT_PEM_BASE64` when prompted. `ADMIN_PASSWORD` must be at least 12 characters.
4. The Blueprint generates `SESSION_SECRET` and `Platform__InternalApiKey`. Keep both stable across ordinary deployments. Rotating `SESSION_SECRET` invalidates active sessions.
5. Set `Platform__OrganizationName`. The service uses Render's `RENDER_EXTERNAL_URL` as the public verification base URL. If you attach a custom domain, explicitly set `Platform__PublicBaseUrl` to that HTTPS origin.
6. The public server must listen on `0.0.0.0:$PORT`; startup configures this. The verification service binds only `127.0.0.1:5001`.
7. Use `/api/health` for the Render health check. Startup waits for the verifier and terminates the container if either the verifier or the Next.js process exits.

For an existing Blueprint service, add newly introduced `sync: false` secrets manually in the Environment tab. Render only prompts for those values during initial Blueprint creation. See [Render Blueprint environment variables](https://render.com/docs/blueprint-spec#setting-environment-variables).

The container runs as a non-root user, excludes local runtime data and signing files from its image, uses production environments, and installs dependencies from the frozen lockfile. No GitHub, Neon, or Render credentials belong in the Docker build arguments.

## 4. Verify before release

Run these checks on a staging Neon branch and Render service first:

1. Build the Docker image, run TypeScript and .NET checks, and confirm the service reaches a healthy state with its actual runtime secrets.
2. Request `/api/events` without a session and with the old forged `credentia-session=1` cookie; both must be denied. Sign in with the configured administrator and check that the session cookie is HttpOnly and Secure over HTTPS.
3. Upload a valid template, create an event, and issue one certificate. Confirm the issued record, PDF, and detached signature are present in PostgreSQL and the public verification URL uses the correct HTTPS domain.
4. Open the public verification link in a logged-out browser. Confirm a valid signature and PDF download, then revoke the certificate as staff and confirm the public status changes.
5. Restart/redeploy the Render service. Confirm the event, template, PDF, signature, and revocation persist and the existing verification link still works.
6. Check an unknown page and an unknown certificate ID. Confirm custom 404 behavior and appropriate API status codes. Submit malformed issuance inputs and an oversized upload; confirm validation errors rather than internal stack traces.
7. Check Render logs for errors and measure peak memory during a representative batch. Use a paid plan if the workload exceeds the selected service's resources or request-duration limits.

Only after staging passes should the production database URL and release branch be deployed. The current repository contains no preseeded events or participant records.

## 5. Release and recovery

Commit the validated code and push the release branch to the GitHub repository connected to Render. Check the Render build and live health check, repeat a small issuance/verification smoke test, and record the deployed commit.

Keep backups of the signing PFX, public root, and signing password in an approved secret store. Verify Neon restore procedures before storing production records. Keep old public roots and signing certificate chains available when rotating signing certificates so previously issued records can retain a valid trust path.

If deployment fails, keep the previous healthy release serving while correcting the environment or code. Database migrations are additive during startup; assess schema compatibility before rolling an application version back. Never restore a test database over production records.

## Current access boundary

Actual provisioning requires an authenticated Neon account, an authenticated Render account connected to the repository, production signing material, and the administrator secret. These values are intentionally absent from source control. The deployment plan and files can be prepared without these credentials; live provisioning and verification require them.

## Local validation completed

The .NET solution passed all 16 existing tests and a separate PostgreSQL integration test against a disposable PostgreSQL 16 container. The integration test created the schema and round-tripped a runtime file. The production Next.js build and full Render Docker image build passed. Local API smoke checks denied anonymous and forged-cookie access, accepted configured administrator login, and returned expected empty and validation responses from PostgreSQL. Live Neon connectivity, Render secrets, certificate issuance, verification across a restart, and Render health remain release gates.
