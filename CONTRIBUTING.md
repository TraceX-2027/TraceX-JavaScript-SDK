# Contributing to TraceX JavaScript & TypeScript SDK

Thank you for your interest in contributing to the **TraceX SDK**! We welcome bug reports, feature proposals, documentation improvements, and pull requests.

---

## 🛠️ Development Setup

The TraceX SDK is organized as a **monorepo** managed with [Bun](https://bun.sh) and Turborepo.

### Prerequisites
- [Bun](https://bun.sh) `>= 1.0.0`
- [Node.js](https://nodejs.org) `>= 18.0.0` (for dual-runtime testing)
- [Git](https://git-scm.com/)

### Clone & Install
```bash
git clone https://github.com/TraceX-2027/TraceX-JavaScript-SDK.git
cd TraceX-JavaScript-SDK
bun install
```

---

## 📦 Monorepo Structure

```text
packages/
├── core/      # @tracex-dev/core - Foundational telemetry engine, ring buffer, scrubber
├── node/      # @tracex-dev/node - Server SDK for Node.js and Bun
├── react/     # @tracex-dev/react - Client SDK for React (Error Boundary, DOM click tracking)
└── nextjs/    # @tracex-dev/nextjs - Full-stack SDK for Next.js App Router & Pages Router

examples/
├── node-bun-sample/           # CLI crash showcase on Node.js and Bun
└── nextjs-app-router-sample/  # Runnable Next.js 16 App Router demonstration
```

---

## 🧪 Running Scripts & Verification

Before submitting a Pull Request, ensure all pre-flight gates pass:

```bash
# 1. Typecheck all packages
bun run typecheck

# 2. Build all packages with tsup (Dual ESM/CJS)
bun run build

# 3. Run the full unit and integration test suite (181 tests)
bun test

# 4. Pack tarballs and run isolated external sandbox verification
bun run pack:all
bun run test:sandbox
```

---

## 📐 Architecture & Coding Guidelines

1. **Zero External Dependencies in `@tracex-dev/core`**: The core package must have **0 runtime dependencies**. Do not add third-party packages to `packages/core/package.json`.
2. **Defensive Isolation**: An SDK must never crash the host application. Wrap all external hooks, listeners, and dispatchers in defensive `try/catch` handlers.
3. **Workspace Protocol**: Inter-package dependencies inside the monorepo must use `"workspace:*"`. The release pipeline automatically substitutes this with explicit semver ranges during packaging.
4. **Dual Module Output**: Every package must produce both ESM (`.js` / `.d.mts`) and CommonJS (`.cjs` / `.d.ts`) artifacts using `tsup`.
5. **No PII Leaks**: Any new breadcrumb or context fields must pass through `DataScrubber` before dispatch.

---

## 🚀 Submitting a Pull Request

1. Create a feature branch: `git checkout -b feat/your-feature-name` or `fix/your-bugfix`.
2. Commit your changes with conventional commit messages: `feat(node): add system metrics`, `fix(core): prevent circular scrubber loop`.
3. Push to your branch and open a Pull Request against `main`.
4. Ensure all CI checks turn green.
