#!/bin/bash
cd "$(dirname "$0")"
exec env -i HOME="$HOME" USER="$USER" PATH="/usr/bin:/bin:/usr/sbin:/sbin" ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .
