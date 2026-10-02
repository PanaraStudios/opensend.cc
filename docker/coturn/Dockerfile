FROM debian:12.11-slim@sha256:b1a741487078b369e78119849663d7f1a5341ef2768798f7b7406c4240f86aef
RUN apt-get update && apt-get install -y --no-install-recommends coturn ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY entrypoint.sh /entrypoint.sh
USER nobody
EXPOSE 3478/tcp 3478/udp 20800-20999/udp
ENTRYPOINT ["sh", "/entrypoint.sh"]
