FROM node:24-alpine
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
ENV HOST=0.0.0.0 PORT=4310 RELAY_WORKSPACE_DIR=/data/workspaces RELAY_BASE_PATH=/tasks-relay
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:4310/tasks-relay/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings=ExperimentalWarning", "server.js"]
