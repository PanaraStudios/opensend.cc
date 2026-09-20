# Authentication verification

Verified on 2026-09-20 using disposable accounts, a separate Convex data volume, and the pinned production Docker image.

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: passed.
- Existing dashboard suite: 200 passed.
- Convex authorization suite: 11 passed, including concurrent bootstrap, concurrent owner demotion, and protection against an IdP claiming an unrelated existing account.
- Playwright (`pnpm test:e2e`): all 17 groups passed against a separate Docker-hosted Convex instance, including all 23 dashboard sections, all three editors, user/team demo isolation, expired invitations, attempted SSO account takeover, shared validation popovers, and light/dark mobile and desktop login hierarchy. The HTML report is generated in `playwright-report/`.
- Browser: signup, verification link from logs, login, initial team creation, invitation signup/verification/login return and acceptance, profile, authenticator enrollment and verification, SSO setup, successful Keycloak sign-in, enforcement, uninvited OIDC rejection, invalid state rejection, and operator recovery.
- Production API smoke: verified email requirement; invitation-only signup; matching-email invitation acceptance; direct organization endpoint rejection; member permission checks; last-admin account deletion refusal; MFA enrollment, invalid OTP, backup-code sign-in and regeneration, password-confirmed disabling; logout and password-reset session revocation; verified email change; team rename; avatar upload/removal; and account deletion.
- Direct-request checks: a new password session retains account access but cannot write team data while SSO is enforced; neither Convex calls nor Better Auth organization endpoints bypass enforcement. A revoked JWT returns a signed-out profile state.
- Persistence: accounts, organizations, sessions, SSO configuration and session proofs survived app/backend restarts.
- Restored UI: original profile cards, compact team rows, member and invitation tables, avatar controls, and confirmation dialogs use the live auth backend. Playwright covers these controls and the profile's team SSO action. The approved login hierarchy, shared validation popovers, and auth panel theme fix remain in place.
- Setup: repeated setup preserved existing data and secrets and left all three production services healthy.

Auth email delivery is the console transport. Email sending and unrelated dashboard functionality remain demo data. The optional Keycloak profile uses disposable test credentials and is not part of the normal deployment.
