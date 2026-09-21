FROM ghcr.io/astral-sh/uv:0.12.17@sha256:10787c682e4184e4f290de1171fd4703dc63de99221f10fe1c99002ce7fa9acc AS uv

FROM python:3.12.14-slim-trixie@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9 AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_PYTHON_PREFERENCE=only-system \
    UV_PYTHON_DOWNLOADS=never \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app
WORKDIR /src
COPY pyproject.toml uv.lock .python-version ./
COPY gen/py gen/py
COPY packages/contracts-py packages/contracts-py
COPY services/orchestrator services/orchestrator
RUN uv sync --locked --no-dev --no-editable --package sifer-orchestrator

FROM python:3.12.14-slim-trixie@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin sifer
COPY --from=build /app /app
ENV PATH=/app/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
USER 10001:10001
EXPOSE 8083
ENTRYPOINT ["sifer-orchestrator"]
