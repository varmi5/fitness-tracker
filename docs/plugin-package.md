# FitnessTrackr downloadable plugin

The live ZIP is https://fitnesstrackr.co.uk/fitnesstrackr-plugin.zip.
The Connect page versions its download URL and filename from the portable manifest.

Canonical inputs:

- `plugins/mcp-logger/plugin.json`: identity, version and public listing.
- `plugins/mcp-logger/mcp.json`: existing hosted MCP URL and OAuth configuration.
- `plugins/mcp-logger/skills/fitness-nutrition-mcp/SKILL.md`: packaged guidance.
- `public/icon-512.png` and `public/icon.svg`: the current website branding.

Run `npm run plugin:build` (Python 3 standard library) after changing these inputs.
It copies the current site artwork, synchronises the legacy Codex manifest/MCP
configuration and standalone skill, and builds the minimal six-file ZIP. No
credentials, database records, app bindings or Next.js application code belong in it.
The older purple dumbbell is no longer used. The hosted MCP initialize response
also advertises the current public site icon/title, derived from the same manifest;
a host may cache its existing icon until its metadata is refreshed.

Run `npm run plugin:check` to verify consistency without modifying anything.
CI runs that check before application tests/build. It validates the current icon,
version/presentation, renewable base scopes, supported tool references and ZIP
inventory. A stale ZIP or legacy auth file fails CI. Site-brand changes therefore
require rebuilding and committing the package as well.

Commit the source and generated files, including `public/fitnesstrackr-plugin.zip`.
The existing push-to-main GitHub Actions workflow deploys the website and MCP to
Coolify. This does not upload or publish a directory package in OpenAI.

For a package metadata/skill/logo release, raise the version and build again,
then upload the completed ZIP to the existing OpenAI plugin. Preserve the
`mcp-logger` identity, MCP URL and existing account connection. Hosted tool changes
are deployed separately; public MCP updates are subject to OpenAI scans/approval.

## Submission status

Version 1.2.0 includes current branding, listing URLs and current tool guidance.
It is not a statement of public review readiness. A recorded demo, review cases,
reviewer sign-in verification, publisher/domain verification and portal checks
still need completion/confirmation. Do not embed reviewer credentials in the ZIP
or claim that installing the archive submits or publishes the plugin.

Physique photos, onboarding/profile writes and detailed Hevy sets are website
features, not current MCP tools. The skill must not claim access to them. Health
history includes stored sleep sessions/naps/stages and available Google/imported
workout/vital data; it does not refresh Google on a read or establish clinical scores.
