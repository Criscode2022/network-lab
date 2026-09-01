# Build context is the monorepo root (Railway dockerfilePath = apps/eve-agent/Dockerfile).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/eve-agent ./apps/eve-agent
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/engine/package.json ./packages/engine/package.json
RUN npm install --workspace=@netbench/eve-agent --include-workspace-root
WORKDIR /app/apps/eve-agent
RUN npx eve build
ENV PORT=8080 NODE_ENV=production
ENV NETBENCH_API_URL=https://api-production-caeb.up.railway.app
EXPOSE 8080
CMD ["npx", "eve", "start", "--host", "0.0.0.0", "--port", "8080"]
