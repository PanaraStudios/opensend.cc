# Domain Connect

"Auto configure" opens the domain's DNS provider with every record filled in.
The user only confirms. Opensend never holds a provider token or calls a
provider API. This follows the [Domain Connect spec](https://github.com/Domain-Connect/spec).

The button appears when the domain's DNS provider supports Domain Connect and
has onboarded `opensend.cc.ses.json`. The template sets `syncPubKeyDomain`, so
providers accept only signed requests. Installations need no key of their own:
`https://opensend.cc/api/domain-connect/sign` signs for them, and it signs only
queries that point a domain at Amazon SES.

## One-time setup (the template owner)

1. Create a signing key and publish its public half under `opensend.cc`:

   ```sh
   openssl genrsa -out dc.key 2048
   openssl rsa -in dc.key -pubout -outform DER | base64 | tr -d '\n'
   ```

   Split the base64 output into chunks of at most 200 characters, and publish
   each chunk `n` as a TXT record at `_dck1.opensend.cc`: `p=n,a=RS256,d=<chunk>`.

2. Set `DOMAIN_CONNECT_KEY=_dck1` and `DOMAIN_CONNECT_PRIVATE_KEY` (the PEM,
   with newlines written as `\n`) on the opensend.cc website.
3. Open a pull request that adds `opensend.cc.ses.json` to
   [Domain-Connect/Templates](https://github.com/Domain-Connect/Templates).
4. After it merges, ask each provider to enable it. Cloudflare's steps are in its
   [Domain Connect docs](https://developers.cloudflare.com/dns/reference/domain-connect/)
   (email `domain-connect@cloudflare.com`).

## Optional installation settings

Set these in `.env.docker`, then run `pnpm setup`:

- `DOMAIN_CONNECT_KEY` and `DOMAIN_CONNECT_PRIVATE_KEY`: sign locally instead of
  asking opensend.cc. Only the template owner has this key.
- `DOMAIN_CONNECT_SIGNER`: a different signer URL.
