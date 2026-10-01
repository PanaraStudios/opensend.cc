FROM python:3.12.12-slim-bookworm@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c
RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv==0.8.22
RUN useradd --uid 10005 --user-group --create-home opensendvoice
WORKDIR /app
COPY services/voice-agent/pyproject.toml services/voice-agent/uv.lock ./
RUN --mount=type=cache,id=opensend-calling-test-voice-agent-uv,target=/root/.cache/uv UV_HTTP_TIMEOUT=300 UV_CONCURRENT_DOWNLOADS=4 uv sync --frozen --no-dev
COPY --chown=opensendvoice:opensendvoice services/voice-agent/voice_agent/ ./voice_agent/
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER opensendvoice
EXPOSE 8094
CMD ["uvicorn", "voice_agent.app:app", "--host", "0.0.0.0", "--port", "8094", "--no-access-log", "--ws-max-size", "65536"]
