# freearfc — TH-D75 Remote

Cross-platform remote control for the JVCKENWOOD **TH-D75** handheld
transceiver: a community reimplementation of the protocol spoken by the
Windows-only *ARFC-D75* software, with an Electron UI and a reusable
plain-Node protocol engine.

![status](https://img.shields.io/badge/status-live--tested-brightgreen)
Validated against a real TH-D75 (fw 1.03, Japan region) over USB CDC —
every command in [`PROTOCOL.md`](PROTOCOL.md) carries its live-verified
semantics.

## Features

- **Both bands, live**: frequency, VFO/Memory/Call/Wx mode, modulation,
  step, attenuator, busy flag, S-meter, battery level
- **Tuning the way an operator expects**: mouse wheel over a band card
  (one selected step per notch), hold-to-repeat ▼▲ buttons with a
  ×1…×100 multiplier, direct MHz entry per band, fine tuning
- **VFO bar**: active band A/B, radio layout 2 VFO / 1 VFO (`DL`)
- **PTT**: one big hold-to-transmit button (bare `TX` / `RX`, hamlib
  semantics) with a TX indicator and the TX band readout
- **VOX toggle** (voice-activated transmit from the radio's own mic)
- **Audio monitor**: loopback the radio's USB-audio (AF / IF / Detect,
  whatever `IO` selects) to your speakers via PipeWire/PulseAudio
- **Local memory**: store/recall frequencies in a PC-side list — the
  radio's own memory bank is not reachable over CAT (that is MCP-D75)
- **Logs**: timestamped application log + raw CAT frame log, collapsible

## Repository layout

```
thd75-remote/            the application
  src/protocol/          transport-agnostic CAT engine (no Electron deps)
  src/main.js            Electron main process: serial, IPC whitelist, polling
  src/main/audio.js      PipeWire/PulseAudio loopback helper (pactl)
  src/preload.js         contextBridge API
  src/renderer/          vanilla HTML/CSS/JS UI
  test/                  protocol + audio parser unit tests (mock transport)
  cli.js                 read-only live probe: node cli.js /dev/ttyACM0
PROTOCOL.md              full reverse-engineered protocol specification
```

Directories such as `ARFC-D75_V100/`, `extracted/`, `decomp/`, `tools/`
are **not part of the repository** (git-ignored): they contain the
original JVCKENWOOD installer and its decompilation, which the ARFC-D75
license forbids redistributing.

## Requirements

- Linux (the UI itself is portable; the audio monitor is Linux-only)
- **Node.js 22 LTS** — pinned in [`.nvmrc`](.nvmrc). If you don't have
  it, the easiest way is [nvm](https://github.com/nvm-sh/nvm):

  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  # restart the shell, then in the repo root:
  nvm install 22     # or just: nvm use
  ```

  (Developed and verified on Node 22 LTS and v27 with npm 12.)
- Serial port access: your user in the `uucp` group
  (`sudo usermod -aG uucp "$USER"`, re-login) or, quick and dirty,
  `sudo chmod 666 /dev/ttyACM0`
- Optional, for Monitor → speakers: PipeWire or PulseAudio (`pactl`)

## Build & run

```bash
git clone git@github.com:r2bln/freearfc.git
cd freearfc
nvm use                # Node 22 per .nvmrc (if you use nvm)
cd thd75-remote
npm install
```

**npm ≥ 11 blocks dependency postinstall scripts**, so Electron's binary
may not unpack itself. If `npm start` complains that Electron is not
installed:

```bash
node node_modules/electron/install.js          # try this first
# if that fails, unpack manually:
#   download https://github.com/electron/electron/releases/download/v33.4.11/electron-v33.4.11-linux-x64.zip
#   unzip it into node_modules/electron/dist/
#   echo -n electron > node_modules/electron/path.txt
```

Then:

```bash
npm test      # 20 unit tests (mock transport, no radio needed)
npm start     # launch the app
```

To update an existing checkout: `git pull`, restart `npm start` — there
is no build step.

## Radio setup

- USB: menu **980 = COM + AF/IF Output** (this also enumerates the
  USB-audio capture device)
- Bluetooth SPP: menu **930 On**
- The radio must **not** be in KISS TNC mode

Select the port (`/dev/ttyACM0 — JVCKENWOOD`), press **Connect**.

## Limitations (hardware, not TODOs)

- **JP-region units transmit on 2 m / 70 cm only.** A PTT key-up with
  the TX band parked outside those windows is silently refused by the
  radio.
- **No PC → radio audio**: the TH-D75's USB audio is capture-only
  (one endpoint, into the computer). Transmit audio always comes from
  the radio's own microphone; VOX is the only voice trigger.
- **Radio memory bank is not accessible over this protocol** — channel
  programming is the separate MCP-D75 product. The UI's *Local memory*
  is a PC-side list, like the original ARFC's frequency lists.

See [`PROTOCOL.md`](PROTOCOL.md) for the full command set, framing,
wake-byte behavior, and the live-verified quirks of the firmware.

## License

MIT for this code. The protocol knowledge was recovered for
interoperability with hardware its users own; the original ARFC-D75
remains JVCKENWOOD's software and is not redistributed here.
