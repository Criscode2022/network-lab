FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/engine ./packages/engine
COPY apps/api ./apps/api
COPY apps/web/package.json ./apps/web/package.json
COPY apps/eve-agent/package.json ./apps/eve-agent/package.json
COPY sql ./sql
RUN npm install --omit=dev --workspace=@netbench/engine --workspace=@netbench/api
ENV PORT=3001 NODE_ENV=production
EXPOSE 3001
CMD ["npm", "run", "start", "-w", "@netbench/api"]
