# Before opening registration

- [ ] Configure the verified Resend sender with `RESEND_API_KEY` and `EMAIL_FROM`. Test delivery, address verification, and password recovery before opening the hostname to new users.
- [ ] Create a Turnstile widget for the Fitness hostname. Set `TURNSTILE_SECRET_KEY` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Verify that the production widget and server-side challenge both work.
- [ ] Use `INVITE_CODE` for invite mode. Use open mode only when public signup is intended. Confirm invalid and unverified registrations fail.
- [ ] Publish a privacy page covering what Fitness stores, retention, who can access it, and export and deletion.
- [ ] Complete the [UK ICO data protection fee self-assessment](https://ico.org.uk/for-organisations/data-protection-fee/data-protection-fee-self-assessment/).
- [ ] Isolate the VM from your home network and verify traffic boundaries.
- [ ] Enable encrypted Postgres backups and test restoring them.
- [ ] Complete a security review of authentication, per-user data isolation, abuse controls, proxy TLS, and operational access.
- [ ] Test export and account deletion with a test member before inviting real users.
