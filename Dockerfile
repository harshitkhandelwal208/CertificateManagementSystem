FROM mcr.microsoft.com/dotnet/sdk:8.0 AS dotnet-build
WORKDIR /source
COPY Directory.Build.props Directory.Packages.props ./
COPY src/CertificateEngine/CertificateEngine.csproj ./src/CertificateEngine/
COPY src/CertificateVerification.Web/CertificateVerification.Web.csproj ./src/CertificateVerification.Web/
RUN dotnet restore src/CertificateEngine/CertificateEngine.csproj && \
    dotnet restore src/CertificateVerification.Web/CertificateVerification.Web.csproj
COPY src/ ./src/
RUN dotnet publish src/CertificateEngine/CertificateEngine.csproj -c Release --no-restore -o /app/engine && \
    dotnet publish src/CertificateVerification.Web/CertificateVerification.Web.csproj -c Release --no-restore -o /app/verification

FROM node:22-bookworm-slim AS node-build
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.9.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY app/ ./app/
COPY components/ ./components/
COPY lib/ ./lib/
COPY public/ ./public/
COPY next.config.mjs tsconfig.json postcss.config.mjs components.json proxy.ts ./
ENV NODE_ENV=production
RUN pnpm build

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=dotnet-build /app/engine ./engine
COPY --from=dotnet-build /app/verification ./verification
COPY --from=node-build /app/.next/standalone ./web
COPY --from=node-build /app/.next/static ./web/.next/static
COPY --from=node-build /app/public ./web/public
COPY scripts/start-render.sh ./start-render.sh
RUN mkdir -p /app/data && chown -R app:app /app/data && chmod 755 /app/start-render.sh
ENV NODE_ENV=production \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_ENVIRONMENT=Production \
    PORT=3000 \
    DATA_DIR=/app/data \
    ENGINE_DLL_PATH=/app/engine/CertificateEngine.dll \
    ENGINE_CWD=/app \
    VERIFICATION_URL=http://127.0.0.1:5001 \
    DOTNET_RUNNING_IN_CONTAINER=true
USER app
EXPOSE 3000
ENTRYPOINT ["/bin/bash", "/app/start-render.sh"]
