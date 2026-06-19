# Escribolt

Local-first voice notes, dictation, meeting capture, and AI-assisted writing for macOS.

Escribolt is a desktop app built with Electron, React, and a local Python backend. The app is designed around fast capture, private local workflows, and optional cloud-connected features for accounts and paid services.

## Features

- Dictation and quick note capture.
- Meeting-aware recording workflows.
- Local notes, recordings, transcripts, and chat context.
- AI writing and Q&A tools with local, BYOK, and managed modes.
- Companion CLI for local assistant integrations.
- Native macOS helpers for keyboard and audio workflows.

## Requirements

- macOS on Apple Silicon.
- Xcode Command Line Tools.
- Node.js 20 or newer.
- npm 10 or newer.
- Python 3.11 or newer.

Install Xcode Command Line Tools with:

```bash
xcode-select --install
```

## Getting Started

Clone the repository and install JavaScript dependencies:

```bash
git clone https://github.com/IAMJUNKI/escribolt.git
cd escribolt
npm install
```

Create a Python virtual environment and install backend dependencies:

```bash
python3 -m venv venv
venv/bin/python -m pip install --upgrade pip
npm run pydeps
```

Create a local environment file:

```bash
cp .env.example .env
```

The default environment points account and cloud features at the Escribolt API:

```text
ESCRIBOLT_BACKEND_URL=https://api.escribolt.com
```

Local notes, local capture, and local development workflows can run without server credentials. Cloud account, billing, and managed AI features require a compatible backend service.

## Development

Start the desktop app in development mode:

```bash
npm start
```

This starts:

- React on `localhost:3000`.
- The Python backend on `localhost:8000`.
- The Electron desktop shell.

Use backend reload while editing Python code:

```bash
npm run start:dev
```

Build native macOS helper binaries when working on keyboard or loopback audio features:

```bash
npm run build:mac-fn-key-helper
npm run build:mac-loopback-helper
```

## Tests

Run the focused Node test suite:

```bash
node --test public/meetingDetection.test.js public/sttFallbackPolicy.test.js public/stt/SttRouter.test.js public/llm/LlmRouter.test.js
```

Run the React production build:

```bash
npm run build
```

Run Python tests:

```bash
venv/bin/python -m pip install pytest
venv/bin/python -m pytest backend
```

## Project Structure

```text
backend/        Local Python backend for transcription, recording, and model workflows
bin/            Companion CLI used by local assistant integrations
native/         Swift sources for macOS helper binaries
public/         Electron main process and shared runtime modules
src/            React renderer app
scripts/        Development helper scripts
```

## Configuration

Runtime defaults live in [.env.example](./.env.example). Copy it to `.env` for local development and change values there. Do not commit `.env` or local credentials.

The public provider id for managed LLM routes is:

```text
ESCRIBOLT_PRO_LLM_PROVIDER_ID=escribolt
```

## Contributing

Keep changes focused and easy to review. Prefer small pull requests with a clear description, screenshots for UI changes, and the relevant test output.

Before opening a pull request, run:

```bash
npm run build
node --test public/meetingDetection.test.js public/sttFallbackPolicy.test.js public/stt/SttRouter.test.js public/llm/LlmRouter.test.js
```

By contributing, you agree to the contributor terms in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

Please do not open public issues for security reports. Follow the [vulnerability disclosure policy](https://docs.escribolt.com/policies/vulnerability-disclosure/).

Never commit secrets, `.env` files, databases, model caches, generated binaries, or local build output.

## License

Escribolt is open source under the GNU Affero General Public License v3.0 or later. See [LICENSE](./LICENSE).

The Escribolt name, logo, app icon, official builds, update channels, domains, and cloud services are not licensed under the AGPL. See [TRADEMARKS.md](./TRADEMARKS.md).

Commercial licenses are available for companies that need proprietary embedding, closed-source modifications, white-label distribution, managed deployments, or other terms outside the AGPL.
