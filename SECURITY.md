# Security Policy

## Supported Versions

Only the latest commit on the `main` branch and the current `latest` container image are actively maintained with security updates.

## Reporting a Vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities (authentication bypasses, cross-user data leaks, OAuth/MCP scope flaws, XSS/CSP bypasses, or cryptographic weaknesses).

Instead, report privately using **GitHub Security Advisories**:
1. Go to the **Security** tab of `varmi5/fitness-tracker`.
2. Click **Report a vulnerability**.
3. Include steps to reproduce, affected files/endpoints, and potential impact.

If GitHub private reporting is unavailable, open a minimal issue asking to establish a private contact channel without posting exploit details.

## Security Model Notes for Self-Hosters

- Always serve production instances over **HTTPS** (`BETTER_AUTH_URL=https://...`).
- Keep `SIGNUP_MODE=closed` unless you have configured Resend email verification and Cloudflare Turnstile (`docs/open-to-others.md`).
- Generate distinct cryptographic random keys for `BETTER_AUTH_SECRET`, `SETUP_CODE`, and `FITNESS_INTEGRATION_KEY`.
- Physique check-in photos/notes are encrypted client-side in the browser; keep your passphrase safe (lost passphrases cannot be recovered by the server).
