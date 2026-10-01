# Source build follows https://janus.conf.meetecho.com/docs/README.html
FROM debian:12.11-slim@sha256:b1a741487078b369e78119849663d7f1a5341ef2768798f7b7406c4240f86aef AS build
ARG JANUS_COMMIT=a71f9cecb72b47fc3d3a7effc575ad6b21a1f4f4
ARG SOFIA_COMMIT=6198851a610b7889c17e2d98fb84617bc1dd7aec
# Packages come from the base image's own bookworm + security mirrors; the base is pinned by digest.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git build-essential autoconf automake libtool pkg-config \
    libglib2.0-dev libjansson-dev libconfig-dev libnice-dev libssl-dev \
    libsrtp2-dev libmicrohttpd-dev zlib1g-dev patch && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init sofia && cd sofia && git remote add origin https://github.com/freeswitch/sofia-sip.git \
    && git fetch --depth=1 origin "$SOFIA_COMMIT" && git checkout --detach FETCH_HEAD \
    && ./bootstrap.sh && ./configure --prefix=/usr/local && make -j2 && make install
RUN git init janus && cd janus && git remote add origin https://github.com/meetecho/janus-gateway.git \
    && git fetch --depth=1 origin "$JANUS_COMMIT" && git checkout --detach FETCH_HEAD
COPY meta-interop.patch /src/meta-interop.patch
RUN cd janus && patch -p1 < /src/meta-interop.patch && sh autogen.sh \
    && ./configure --prefix=/opt/janus --disable-all-plugins --enable-plugin-sip \
      --disable-all-transports --enable-rest --disable-data-channels \
      --disable-websockets --disable-rabbitmq --disable-mqtt --disable-nanomsg \
      --disable-unix-sockets --disable-all-handlers --disable-all-loggers --disable-post-processing \
    && make -j2 && make install

FROM debian:12.11-slim@sha256:b1a741487078b369e78119849663d7f1a5341ef2768798f7b7406c4240f86aef
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libglib2.0-0 libjansson4 libconfig9 libnice10 libssl3 libsrtp2-1 \
    libmicrohttpd12 zlib1g openssl curl gettext-base && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 janus && mkdir -p /certs /opt/janus/etc/janus \
    && chown -R janus:janus /certs /opt/janus
COPY --from=build /opt/janus /opt/janus
COPY --from=build /usr/local/lib/libsofia-sip-ua.so* /usr/local/lib/
RUN ldconfig && chown -R janus:janus /opt/janus
COPY *.jcfg* /opt/janus/etc/janus/
COPY entrypoint.sh /entrypoint.sh
USER janus
EXPOSE 8088/tcp 7088/tcp 20000-20199/udp
ENTRYPOINT ["sh", "/entrypoint.sh"]
