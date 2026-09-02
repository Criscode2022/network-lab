# eve (built below for the /eve proxy) requires Node >= 24; local dev runs 24 as well.
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/engine ./packages/engine
COPY apps/api ./apps/api
COPY apps/web/package.json ./apps/web/package.json
COPY apps/eve-agent ./apps/eve-agent
COPY sql ./sql
RUN npm install --omit=dev --workspace=@netbench/engine --workspace=@netbench/api --workspace=@netbench/eve-agent
WORKDIR /app/apps/eve-agent
RUN npx eve build
WORKDIR /app
RUN chmod +x apps/api/start.sh
ENV PORT=3001 NODE_ENV=production EVE_ORIGIN=http://127.0.0.1:4010
ENV NETBENCH_API_URL=https://api-production-caeb.up.railway.app
EXPOSE 3001
CMD ["sh", "apps/api/start.sh"]
