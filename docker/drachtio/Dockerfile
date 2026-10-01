# Official multi-architecture release, pinned to its manifest digest.
FROM drachtio/drachtio-server:0.9.11@sha256:b229fc724b88a9fca249610d8498ad199e5bfe65bb0004026e346d5f37403507
RUN groupadd --gid 10004 drachtio && useradd --uid 10004 --gid 10004 --no-create-home drachtio \
    && mkdir -p /run/drachtio && chown drachtio:drachtio /run/drachtio
COPY entrypoint.sh /opensend-entrypoint.sh
USER drachtio
ENTRYPOINT ["/bin/sh", "/opensend-entrypoint.sh"]
