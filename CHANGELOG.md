# Changelog

All notable changes to this project will be documented in this file.

## [1.0.5] - 2026-07-09

- Fix AI Router abandoning stalled streams before any response data was sent — now retries or falls back instead of giving up
- Detect stalled API responses faster to reduce wait time on dead connections
- Add password authentication for tunnels as an alternative to one-time connect links
- Add tunnel auto-start option to resume the tunnel automatically on app launch
- Make chat working status text translatable for non-English users
- Remove VS Code extension support
- Remove agent manager and agent groups feature
- Update in-app changelog, bug report, and feature request links to point to the Ocelot repository

## [1.0.4] - 2026-07-08

- Use OpenCode `modalities` field instead of custom `attachment` flag for AI Router image input support

## [1.0.3] - 2026-07-08

- Fix AI Router stream stall causing UI to hang indefinitely when upstream API drops mid-response
- Fix AI Router stream stall preventing fallback when API silently drops after partial output
- Fix send/stop button missing from collapsed mobile input pill when content is present
- Add image support toggle to AI Router route settings (default off)

## [1.0.2] - 2026-07-08

- Fix AI Router causing OpenCode to compact context every few messages
- Fix AI Router models missing context/input/output limits in OpenCode config
- Fix AI Router provider requiring API key in settings despite being a local proxy
- Improve AI Router fallback logging to show target route and endpoint

## [1.0.1] - 2026-07-07

- Fix AI Router baseURL path mismatch (provider-inject.js)
- Enable bundled OpenCode CLI upgrade at runtime (download, replace, restart)
- Remove bundled-mode shortcut in upgrade-status check

## [1.0.0] - 2026-07-07

- Forked from [openchamber](https://github.com/btriapitsyn/openchamber)
- Added AI Router to unify `thinking` parameter handling across different providers
- Added automatic failover in AI Router to prevent workflows from stopping when an API endpoint fails
