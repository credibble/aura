# Aura oracle — multi-stage build.
# Context must be the REPO ROOT (npm workspaces: packages/* + oracle),
# e.g.  docker build -f oracle/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY oracle/package.json oracle/
RUN npm ci

COPY packages/contracts packages/contracts
COPY oracle oracle
RUN npm run build -w @aura/contracts \
 && npx prisma generate --schema oracle/prisma/schema.prisma \
 && npm run build -w @aura/oracle

# --- runtime ---------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Workspace node_modules (hoisted) + built artifacts + prisma schema/scripts.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/oracle/package.json ./oracle/package.json
COPY --from=build /app/oracle/dist ./oracle/dist
COPY --from=build /app/oracle/prisma ./oracle/prisma
COPY --from=build /app/oracle/scripts ./oracle/scripts
COPY --from=build /app/oracle/docker-entrypoint.sh ./oracle/docker-entrypoint.sh
RUN chmod +x ./oracle/docker-entrypoint.sh

WORKDIR /app/oracle
EXPOSE 4000
# Runs `prisma migrate deploy` before the process starts (see the script).
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
