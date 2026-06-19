# Escribolt Companion Skill

This skill allows your AI assistant to read notes, transcripts, and context from your Escribolt desktop app.

## How to use Escribolt Companion CLI

Escribolt Companion CLI is a command-line tool that communicates with Escribolt via a secure local Unix socket. It can list, get, and search notes and audio transcripts.

The executable is located at `{{binary_path}}`.

### Commands

1. **List notes**:
   ```bash
   {{binary_path}} notes list --limit 10
   ```

2. **Get note content**:
   ```bash
   {{binary_path}} notes get --id <uuid>
   ```

3. **Get audio recording transcript**:
   ```bash
   {{binary_path}} notes transcript get --id <uuid>
   ```

### Guidelines for AI Agent

- When asked to summarize recent voice memos, recordings, or notes:
  1. Run `{{binary_path}} notes list --limit 10` to get the list of recent notes and recordings.
  2. Use the relevant ID to fetch the full note content using `{{binary_path}} notes get --id <uuid>`.
  3. If there is an associated recording or transcript, fetch it using `{{binary_path}} notes transcript get --id <uuid>`.
  4. Perform synthesis and present the final summary to the user.
