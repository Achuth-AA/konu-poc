FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    TZ=Asia/Kolkata

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt \
 && python -m playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

COPY konu_crawlers ./konu_crawlers
COPY deploy ./deploy

# CSV, SQLite store and status.json live here; mount a disk on it.
VOLUME ["/app/data"]

CMD ["python", "-m", "konu_crawlers", "schedule", "--config", "deploy/schedule.json"]
