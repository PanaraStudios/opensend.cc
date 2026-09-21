# Retired SES component

`packages/ses` was retired on `feat/ses-onboarding`. It is no longer a workspace
package or a published application dependency. Opensend now owns the installation,
credentials, team authorization, and domain services directly in `convex/`.

The review and runbook here are historical evidence, not current setup instructions.
The old test sources in `regression-scenarios/` are preserved as text so later
milestones can port delivery, scheduling, suppression, cancellation, and feedback
regressions without retaining a second runtime implementation. Their historical
passing counts do not describe the current application.

Current tests port the ownership-policy merge, AWS-returned DKIM zone, real RSA
signature fixtures, forged signatures, bounded request body, and retry scenarios.
The historical Python setup helper and its five regression tests remain runnable:

```sh
python3 -m unittest discover -s docs/legacy-ses -p 'test_*.py'
```

Use [the application setup guide](../ses-onboarding.md) for this implementation.
