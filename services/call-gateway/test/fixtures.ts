export const offer =
  [
    "v=0",
    "o=- 1234 1 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=ice-lite",
    "m=audio 40000 UDP/TLS/RTP/SAVPF 111",
    "c=IN IP4 127.0.0.1",
    "a=mid:0",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    "a=ptime:20",
    "a=rtcp-mux",
    "a=sendrecv",
    "a=ice-ufrag:test",
    "a=ice-pwd:123456789012345678901234",
    `a=fingerprint:sha-256 ${Array(32).fill("AA").join(":")}`,
    "a=setup:actpass",
    "a=candidate:1 1 UDP 2130706431 127.0.0.1 40000 typ host",
    "a=end-of-candidates",
    "a=ssrc:1 cname:test",
  ].join("\r\n") + "\r\n"
export const answer = offer
  .replace("a=ice-lite\r\n", "")
  .replace("a=setup:actpass", "a=setup:active")
