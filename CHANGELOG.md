# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-06

### Added

- Added `positron_table_summary` for bounded native metadata and profiles of existing foreground-session tables and data frames.
- Added `positron_console_history` for bounded recent console context, respecting Positron's console-history privacy setting.
- Added the bundled `positron` Codex skill and non-blocking onboarding action that copies its manual install command.

## [0.1.0] - 2026-09-05

### Added

- Exposed the foreground Positron R or Python session through a local Streamable HTTP MCP server.
- Added session inspection, variable inspection, silent evaluation, and transparent execution tools.
- Added the extension logo at `images/icon.png`.

### Security

- Restricted the MCP listener to IPv4 loopback and rejected non-loopback browser origins.
- Kept tool inputs, executed code, runtime values, and credentials out of lifecycle logs.
