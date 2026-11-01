# TH-D75 Remote

Cross-platform (Linux / Windows / macOS) remote control for the
JVCKENWOOD **TH-D75** handheld transceiver. A community reimplementation
of the protocol used by the Windows-only *ARFC-D75* software — see
[`../PROTOCOL.md`](../PROTOCOL.md) for the full reverse-engineered
specification.

![status](https://img.shields.io/badge/status-experimental-orange) The
protocol was recovered statically from ARFC-D75 1.0.8717.20672 and has
**not yet been validated against a live radio**. Expect rough edges until
first hardware contact; the frame log (bottom pane) exists exactly so the
first session can be debugged.

## What it does

- Connect over USB CDC or Bluetooth SPP (115200 8N1)
- Full connect handshake: enter control mode (`TC 1`), identity (`ID`),
  DV-gateway guard (`GW`), state sync of both bands
- Live display: frequency, mode, step, attenuator, busy, S-meter
  (auto-information + 1 s polling)
- Control: set frequency / mode / coarse+fine steps, ±1/2/5/10/50/100-step
  tune, fine tuning, USB output select (AF/IF/Detect), volume, GPS ± PC
  output, TNC, single/dual band
- Frame-level TX/RX log for reverse-engineering sessions

## Run

Requirements: Node.js ≥ 18, a display, serial port access
(`uucp`/`dialout` group on Linux).

```bash
cd thd75-remote
npm install            # if postinstall is blocked by npm ≥ 11:
                      #   node node_modules/electron/install.js
                      #   echo -n electron > node_modules/electron/path.txt
npm test               # protocol unit tests (mock transport)
npm start              # launch the app
```

On the radio (see ARFC help): USB → menu 980 `COM + AF/IF Output`;
Bluetooth → menu 930 On. The radio must not be in KISS TNC mode.

## Layout

```
src/protocol/commands.js   wire constants (bands, modes, steps, tones…)
src/protocol/connection.js protocol engine: framing, queue, parsers, commands
src/main.js                Electron main: serialport, IPC whitelist, polling
src/preload.js             contextBridge API
src/renderer/              UI (vanilla HTML/CSS/JS)
test/protocol.test.js      12 unit tests against a mock transport
```

The protocol engine is deliberately Electron-free and transport-agnostic —
it can be reused from plain Node (e.g. CLI) or tests.

## License / scope

MIT for this code. The protocol knowledge it embodies was extracted for
interoperability with hardware its users own; the original ARFC-D75
remains JVCKENWOOD's software and is not redistributed here.
