# Token-free source route: https://developer.signalwire.com/freeswitch/foundations/getting-started/
FROM debian:12.11-slim@sha256:b1a741487078b369e78119849663d7f1a5341ef2768798f7b7406c4240f86aef AS build
# v1.11.3; dependency minimums are checked in the tagged configure.ac.
ARG FREESWITCH_COMMIT=ef32e205295e29f034f1453ad245ba5efb07b94a
# Sofia-SIP v1.13.18 and SpanDSP v3.1.1 (ABI 4).
ARG SOFIA_COMMIT=ad36ac8f755308e8b87f98a505e83d4e408e5cc3
ARG SPANDSP_COMMIT=8f1e1646bdec99eac5fd2cd92c35563f736b9b89
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git build-essential autoconf automake libtool libtool-bin pkg-config patch \
    libssl-dev libcurl4-openssl-dev libpcre2-dev libspeex-dev libspeexdsp-dev \
    libsqlite3-dev libedit-dev libldns-dev libsndfile1-dev libopus-dev \
    libjpeg62-turbo-dev zlib1g-dev libtiff-dev uuid-dev yasm nasm python3 espeak \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init sofia && cd sofia && git remote add origin https://github.com/freeswitch/sofia-sip.git \
    && git fetch --depth=1 origin "$SOFIA_COMMIT" && git checkout --detach FETCH_HEAD \
    && ./bootstrap.sh && ./configure --prefix=/usr/local && make -j2 && make install
RUN git init spandsp && cd spandsp && git remote add origin https://github.com/freeswitch/spandsp.git \
    && git fetch --depth=1 origin "$SPANDSP_COMMIT" && git checkout --detach FETCH_HEAD \
    && ./bootstrap.sh && ./configure --prefix=/usr/local && make -j2 && make install
RUN git init freeswitch && cd freeswitch && git remote add origin https://github.com/signalwire/freeswitch.git \
    && git fetch --depth=1 origin "$FREESWITCH_COMMIT" && git checkout --detach FETCH_HEAD && ./bootstrap.sh -j
COPY modules.conf /src/freeswitch/modules.conf
COPY ecdsa-dtls.patch /src/ecdsa-dtls.patch
RUN cd freeswitch && patch -p1 < /src/ecdsa-dtls.patch \
    && ./configure --prefix=/opt/freeswitch --disable-libyuv --disable-libvpx \
    && make -j2 && make install \
    && mkdir -p /opt/freeswitch/sounds \
    && espeak -w /opt/freeswitch/sounds/calling-welcome.wav 'Open Send calling demo. Press one for a tone. Press two to repeat.' \
    && espeak -w /opt/freeswitch/sounds/calling-invalid.wav 'Please press one or two.'

FROM debian:12.11-slim@sha256:b1a741487078b369e78119849663d7f1a5341ef2768798f7b7406c4240f86aef
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 libcurl4 libpcre2-8-0 libspeex1 libspeexdsp1 libsqlite3-0 \
    libedit2 libldns3 libsndfile1 libopus0 libjpeg62-turbo zlib1g libtiff6 libuuid1 \
    openssl gettext-base && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10002 freeswitch && mkdir -p /recordings /certs /opt/freeswitch \
    && chown -R freeswitch:freeswitch /recordings /certs /opt/freeswitch
COPY --from=build /opt/freeswitch /opt/freeswitch
COPY --from=build /usr/local/lib/libsofia-sip-ua.so* /usr/local/lib/
COPY --from=build /usr/local/lib/libspandsp.so* /usr/local/lib/
RUN ldconfig && rm -rf /opt/freeswitch/conf && mkdir -p /opt/freeswitch/conf/directory \
    && chown -R freeswitch:freeswitch /opt/freeswitch
COPY conf/ /templates/
COPY entrypoint.sh /entrypoint.sh
USER freeswitch
EXPOSE 5060/udp 5060/tcp 7443/tcp 8021/tcp 20400-20799/udp
ENTRYPOINT ["sh", "/entrypoint.sh"]
