# Build context is the monorepo root (Railway dockerfilePath = apps/web/Dockerfile).
FROM node:22-slim AS build
WORKDIR /src
COPY apps/web ./apps/web
WORKDIR /src/apps/web
RUN npm install && npm run build

FROM nginx:1.27-alpine
COPY --from=build /src/apps/web/dist/web/browser /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
