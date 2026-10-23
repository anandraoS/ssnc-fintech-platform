# React production bundle served by unprivileged nginx (same nginx.conf as the Angular image: security headers, SPA fallback,
# same-origin /api proxy). Build context: repository root.
FROM node:22.11-alpine AS build
WORKDIR /workspace/frontend-react
COPY frontend-react/package.json frontend-react/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend-react/ ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY infrastructure/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/frontend-react/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://localhost:8080/healthz || exit 1
