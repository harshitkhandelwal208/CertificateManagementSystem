# NGO Certificate Operations & Independent Verification Platform

A production-ready, self-hosted certificate issuance and cryptographic verification platform designed specifically for NGOs, training cohorts, and educational non-profits.

The platform provides **two specialized services** powered by **one unified Next.js design system**:
1. **NGO Admin Operations Console** (`http://localhost:3000`): A private, authenticated management portal for NGO staff to create cohorts, issue certificates (via manual input or CSV batch upload), download cryptographically signed PDFs, and manage revocations.
2. **Independent Cryptographic Verification Service** (`http://localhost:5001`): An independent verification service that cryptographically validates attached CMS detached digital signatures (`.p7s`) and SHA-256 artifact hashes against the organization's offline Root Certificate Authority, with browser visitors seamlessly viewing the unified dark-themed Next.js verification stage (`http://localhost:3000/verify/{id}`).

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph NGOConsole ["Service 1: NGO Admin Console (Next.js - Port 3000)"]
        Staff[NGO Staff / Coordinators]
        AdminUI[NGO Admin Portal<br/>Protected /events, /certificates]
        Staff -->|Authenticate & Manage| AdminUI
        CSV[CSV Recipient Dropzone] -->|Batch Issuance| AdminUI
        Manual[Manual Entry Form] -->|Single Issuance| AdminUI
        DB[(Local SQLite Ledger<br/>certificates.db & users)]
        AdminUI -->|Direct Queries node:sqlite| DB
        CLI[One-Shot Signer CLI<br/>CertificateEngine.dll]
        AdminUI -->|Execute on-demand| CLI
        CLI --> PDF[Signed PDF & .p7s<br/>X.509 RSA-4096 / SHA-256]
        CLI --> DB
    end

    subgraph IndependentVerify ["Service 2: Independent Verification (Port 5001)"]
        Verifier[Participant / Employer / Verifier]
        VerifyWeb[CertificateVerification.Web<br/>Port 5001]
        RootCA[(Offline Root CA<br/>root-ca.pem)]
        
        Verifier -->|Scan QR or Check ID| VerifyWeb
        VerifyWeb -->|Cryptographic Verification API<br/>GET /api/verify/{id}| DB
        VerifyWeb -->|Custom Root Trust Chain Check| RootCA
        VerifyWeb -.->|Browser Redirect 302| UnifiedUI[Unified Verification UI<br/>http://localhost:3000/verify/{id}]
    end

    subgraph UnifiedUIStage ["Single Unified UI System (Next.js)"]
        UnifiedUI --> Stage[3D CertStage & Ambient Tilt]
        UnifiedUI --> Wax[Official 3D Wax Seal]
        UnifiedUI --> Proof[Evervault Cryptographic Card<br/>Live Hash & Digital Signature Status]
        UnifiedUI --> Actions[Download Official PDF<br/>Print • Share • LinkedIn]
    end
```

---

## 1. NGO Admin Operations Console (`Port 3000`)

The Admin Console is password-protected and accessible only to authorized NGO coordinators and administrators.

### Core Staff Workflows

#### 1. Cohort & Event Management (`/events`)
- Track all ongoing and completed training cohorts.
- View real-time issuance progress bars (`issuedCount / totalCount`).
- Create new cohorts with customized certificate design templates (`/events/new`).

#### 2. Recipient Credential Issuance (`/events/{id}/issue`)
- **Manual Input**: Add recipient names, emails, and phone numbers directly.
- **CSV Batch Upload**: Drop any standard spreadsheet CSV with `Name` and `Email` columns. The client-side parser automatically validates recipient rows and enables one-click batch issuance with cryptographic signing executed in milliseconds.

#### 3. Complete Certificate Registry (`/certificates`)
- Comprehensive audit log of every credential ever issued.
- Live keyword search by recipient name, email, or certificate number.
- Filter by status (`All`, `Issued`, `Revoked`).
- **Direct PDF Download**: Instantly download the cryptographically signed certificate PDF.
- **Verify**: One-click link to open the certificate in the verification stage.
- **Auditable Revocation**: Revoke any certificate with a mandatory reason (e.g. "Issued in error" or "Requirements not met"). Revocations are reflected immediately across all verification checkpoints.

---

## 2. Independent Public Verification Service (`Port 5001`)

The Verification Service operates as an independent cryptographic trust anchor:
- **Zero-Login Required**: Anyone holding a certificate can verify it instantly without an account.
- **Tamper-Evident Security**: Evaluates the attached `.p7s` Cryptographic Message Syntax (CMS) digital signature and checks the SHA-256 hash of the PDF artifact.
- **Custom Root CA Trust**: Validates the cryptographic chain against the organization's offline Root CA (`data/ca/root-ca.pem`).
- **Unified UI**: Browser users visiting `http://localhost:5001/verify/{id}` or `http://localhost:5001/` are seamlessly routed to the rich Next.js verification stage (`http://localhost:3000/verify/{id}`), featuring 3D tilt presentation, wax seal, PDF download, and Evervault cryptographic proof.

---

## Quickstart (Local Development)

### Prerequisites
- [.NET 8.0 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Node.js 18+](https://nodejs.org) and `pnpm` (or `npx pnpm`)
- SQLite3

### 1. Initial Setup & CA Initialization
Generate the organization's root certificate authority and signing keys:
```bash
dotnet run --project tools/CertificateEngine.CaTool -- init \
  --organization "Your NGO Name" \
  --out data/ca \
  --root-years 20 \
  --signing-years 2 \
  --root-password "RootPassword123!" \
  --signing-password "SigningPassword123!" \
  --force
```
*Note: This creates `data/ca/root-ca.pem`, `data/ca/root-ca.pfx`, and `data/ca/signing.pfx`. Keep `root-ca.pfx` secure and move it to cold storage for production.*

### 2. Configure Environment (`.env.local`)
Create `.env.local` for the Next.js frontend:
```bash
VERIFICATION_URL=http://localhost:5001
NEXT_PUBLIC_VERIFICATION_URL=http://localhost:5001
```

### 3. Run the Platform (Exactly Two Services)

Start the two services in separate terminals:

```bash
# Terminal 1: Independent Cryptographic Verification Service (Port 5001)
dotnet run --project src/CertificateVerification.Web --urls "http://localhost:5001"

# Terminal 2: NGO Admin Operations & Verification UI (Port 3000)
npx pnpm dev
```

Default administrative account for testing:
- **Email**: `admin@credentia.local`
- **Password**: `Password123!`

---

## Running Automated Tests

Run the full automated test suite:
```bash
dotnet test CertificatePlatform.sln
```

Verify Next.js production build:
```bash
npx pnpm build
```

---

## Cloud Hosting & Render Free Tier Deployment

The platform is fully packaged for zero-cost cloud hosting on **Render Free Tier Web Services** (512 MB RAM limit). 

### How It Works in Cloud Containers
Render Free Tier assigns a single dynamic port via the `$PORT` environment variable and enforces a strict 512 MB RAM limit:
- **Unified Front-Facing Gateway**: Next.js runs in standalone mode on `0.0.0.0:$PORT`, serving both the NGO Admin Console and the Independent Verification Stage.
- **Internal Cryptographic Service**: `CertificateVerification.Web` runs internally on `127.0.0.1:5001`, providing detached CMS signature checks and root CA validation.
- **On-Demand Issuance**: Certificate signing is executed via sub-second on-demand CLI invocation (`CertificateEngine.dll`), immediately freeing memory after each batch.
- **Ultra-Low Memory Footprint**: Steady-state memory is only **~60-86 MB RAM** (less than 17% of the 512 MB limit), completely preventing Out-Of-Memory (OOM) crashes.

### Option 1: Deploy with Render Blueprint (`render.yaml`)
1. Fork or push this repository to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com), click **New +** -> **Blueprint**.
3. Select your repository. Render automatically reads `render.yaml` and provisions the Web Service using the Dockerfile.
4. Set any custom environment variables (e.g. `Platform__OrganizationName`, `Signing__PfxPassword`).
5. Click **Apply**. Render will build and deploy the container with health checks automatically monitored at `/api/health`.

### Option 2: Deploy Manually as a Docker Web Service on Render
1. In Render, select **New +** -> **Web Service**.
2. Connect your GitHub repository.
3. Configure settings:
   - **Environment**: `Docker`
   - **DockerfilePath**: `./Dockerfile`
   - **Instance Type**: `Free`
   - **Health Check Path**: `/api/health`
4. Add environment variables:
   - `NODE_ENV`: `production`
   - `Platform__OrganizationName`: `Clinically Evolve Foundation` (or your NGO name)
   - `Platform__InternalApiKey`: *(your secret key)*
   - `Signing__PfxPassword`: `SigningPassword123!`
5. Click **Create Web Service**.

### Option 3: Local Docker Testing
You can build and test the production container locally with standard Docker:
```bash
# Build the production container
docker build -t cert-platform-render .

# Run the container (mapping port 3000)
docker run -p 3000:3000 cert-platform-render

# Test health check
curl http://localhost:3000/api/health
```

---

## Production Deployment & Operational Documentation

Detailed step-by-step guides for production deployment and external integrations:

1. [**Google Forms & Sheets Setup**](docs/google-setup.md) — Google Cloud service accounts, permission sharing, and sheet column mappings.
2. [**Email Delivery & DNS Deliverability**](docs/email-dns.md) — SPF, DKIM milters, DMARC, and PTR setup for 100% inbox delivery.
3. [**WhatsApp Delivery (Meta Cloud API)**](docs/whatsapp-setup.md) — Meta Business verification, permanent system tokens, and message template approval.
4. [**Signing Key & CA Cryptography**](docs/signing-key-and-ca.md) — Root CA lifecycle, key protection, and cold storage best practices.
5. [**Production Hosting & Hardening**](docs/hosting.md) — Systemd service sandbox, Caddy reverse proxy, TLS, firewall, and encrypted SQLite backups.

