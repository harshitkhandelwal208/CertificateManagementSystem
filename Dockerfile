# ===============================================================
# Stage 1: Build .NET 8 Engine CLI & Verification Service
# ===============================================================
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS dotnet-build
WORKDIR /source

COPY Directory.Build.props Directory.Packages.props ./
COPY src/CertificateEngine/CertificateEngine.csproj ./src/CertificateEngine/
COPY src/CertificateVerification.Web/CertificateVerification.Web.csproj ./src/CertificateVerification.Web/

RUN dotnet restore src/CertificateEngine/CertificateEngine.csproj && \
    dotnet restore src/CertificateVerification.Web/CertificateVerification.Web.csproj

COPY src/ ./src/

RUN dotnet publish src/CertificateEngine/CertificateEngine.csproj -c Release -o /app/engine && \
    dotnet publish src/CertificateVerification.Web/CertificateVerification.Web.csproj -c Release -o /app/verification

# ===============================================================
# Stage 2: Build Next.js 16 Standalone Application
# ===============================================================
FROM node:22-bookworm-slim AS node-build
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install

COPY app/ ./app/
COPY components/ ./components/
COPY lib/ ./lib/
COPY public/ ./public/
COPY data/ ./data/
COPY next.config.mjs tsconfig.json postcss.config.mjs components.json ./

ENV NODE_ENV=production
RUN pnpm build

# ===============================================================
# Stage 3: Low-Memory Production Runtime (Render Free Tier 512MB)
# ===============================================================
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

# Copy Node.js 22 runtime binary into the .NET ASP.NET Bookworm environment
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node

# Copy published .NET 8 artifacts
COPY --from=dotnet-build /app/engine ./engine
COPY --from=dotnet-build /app/verification ./verification

# Copy Next.js standalone server and static assets
COPY --from=node-build /app/.next/standalone ./web
COPY --from=node-build /app/.next/static ./web/.next/static
COPY --from=node-build /app/public ./web/public

# Copy pre-seeded data directory (SQLite DB, CA certificates, and templates)
COPY data/ ./data/

# Symlink so /app/web/data resolves to /app/data directly
RUN ln -s /app/data /app/web/data

# Copy startup orchestration script
COPY scripts/start-render.sh ./start-render.sh
RUN chmod +x ./start-render.sh

# Environment variables for cloud hosting
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATA_DIR=/app/data
ENV ENGINE_DLL_PATH=/app/engine/CertificateEngine.dll
ENV ENGINE_CWD=/app
ENV VERIFICATION_URL=http://127.0.0.1:5001
ENV Platform__DataDirectory=/app/data
ENV Platform__OrganizationName="Clinically Evolve Foundation"
ENV Signing__PfxPassword=SigningPassword123!
ENV DOTNET_RUNNING_IN_CONTAINER=true

EXPOSE 3000

ENTRYPOINT ["/bin/bash", "/app/start-render.sh"]
