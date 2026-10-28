
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DENO_INSTALL=/usr/local

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ffmpeg ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

# Deno JavaScript 런타임 설치
RUN curl -fsSL https://deno.land/install.sh | sh \
    && ln -sf /usr/local/bin/deno /usr/local/bin/deno

# yt-dlp와 EJS 구성 요소 설치
RUN pip install --no-cache-dir --upgrade "yt-dlp[default]"

WORKDIR /app
COPY . /app

EXPOSE 10000
CMD ["python", "backend/server.py"]
