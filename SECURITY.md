# Security Policy

TraceX takes the security of our telemetry SDKs and our users' data with the utmost seriousness.

---

## 🔒 Supported Versions

We provide security patches for the following versions:

| Package Version | Supported          |
| :--- | :--- |
| `0.1.x` | :white_check_mark: |
| `< 0.1.0` | :x: |

---

## 🛡️ Reporting a Vulnerability

If you discover a security vulnerability in any TraceX package, please **DO NOT** open a public GitHub issue.

Instead, please report security issues privately via:
- **Email:** `security@tracex.dev` (or contact project maintainer: `kareem.adel.awad@gmail.com`)
- **GitHub Security Advisory:** Submit a private advisory at [https://github.com/TraceX-2027/TraceX-JavaScript-SDK/security/advisories/new](https://github.com/TraceX-2027/TraceX-JavaScript-SDK/security/advisories/new)

### What to Include
Please provide:
1. Package name and version (`@tracex-dev/core`, `@tracex-dev/node`, etc.)
2. Detailed description of the vulnerability
3. Minimal proof-of-concept (PoC) code or steps to reproduce
4. Potential impact (e.g. PII leak, denial of service, remote code execution)

### Response Timeline
- **Initial Response:** Within 24–48 hours confirming receipt.
- **Triage & Patch:** We will work on a verified fix and release a patch via npm promptly.
- **Public Disclosure:** Coordinated disclosure after the patch has been published and adopted.
