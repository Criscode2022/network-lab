FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json* ./
COPY . .
RUN npm install && npm run build

FROM nginx:1.27-alpine
COPY --from=build /src/dist/web/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
