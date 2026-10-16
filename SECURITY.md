# Security Policy

## Supported versions

Security fixes are provided for the latest published `0.3.x` version during the current public beta. Older development builds are not supported.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** private reporting form for this repository. Do not open a public Issue for vulnerabilities that could expose LitFinch data, device identifiers, service credentials or arbitrary code execution.

Include the affected version, Zotero version, operating system, reproduction steps, impact and the smallest safe proof of concept. Remove paper content, personal links, device IDs, API keys and patient information before submitting.

Reports are reviewed on a best-effort basis during the public beta; no formal response-time SLA is currently offered. A validated issue will be fixed privately before public disclosure whenever practical.

## Security boundary

Zotero plugins run with broad access to Zotero and the local computer. Install Connector only from this repository's Releases page or the LitFinch download endpoint listed in the README, and verify that the repository owner is `lvyrana`.

The current anonymous device ID is a bearer credential, not a complete account system. Do not share personal links. Formal revocable connector tokens remain a requirement before marketplace submission.
