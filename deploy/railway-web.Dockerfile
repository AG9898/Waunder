# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

FROM caddy:2.10-alpine
WORKDIR /srv

COPY client/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
ENV PORT=8080
EXPOSE 8080
