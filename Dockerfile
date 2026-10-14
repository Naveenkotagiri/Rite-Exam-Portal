# Rite Exam Portal: one image with the built React website and the Python (FastAPI) backend.
#   docker build -t rite-exam-portal .
#   docker run -p 3000:3000 -e DATABASE_URL=... -e JWT_SECRET=... rite-exam-portal

# ---- 1. Build the website ----
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY vite.config.js ./
COPY client ./client
COPY shared ./shared
RUN npm run build

# ---- 2. Python backend serving the API and the website ----
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 APP_ENV=production PORT=3000
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /app/dist /app/dist
RUN useradd --system --no-create-home portal && chown -R portal /app
USER portal
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/api/health')"
CMD ["python", "-m", "app.server"]
