#!/usr/bin/env bash
# install-mac.sh - copy the built devices into the Ableton User Library
# (Max For Live/m4l-jweb), replacing any previous install.
#
# The User Library path is read from the newest Live preferences file
# (~/Library/Preferences/Ableton/Live */Library.cfg, <ProjectPath>); Live's
# default location is the fallback.
#
# The device-folder name defaults to this repo's, and `m4l-jweb install` passes
# the package name explicitly - so a repo scaffolded under another name works.
#
# usage: install-mac.sh [device-name] [src-dir]
# `m4l-jweb install` passes both; standalone (from the zip) both are inferred.
set -euo pipefail
device_name="${1:-m4l-jweb}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source: an explicit second argument, else ./<name> next to this script (zip and
# dist layouts), else ../dist/<name> (running it straight from a repo checkout).
src="${2:-}"
if [ -z "$src" ]; then
	src="$here/$device_name"
	[ -d "$src" ] || src="$(dirname "$here")/dist/$device_name"
fi
if ! compgen -G "$src/*.amxd" > /dev/null; then
	echo "No .amxd found next to this script or in dist/. Run 'pnpm build' first." >&2
	exit 1
fi

user_lib=""
cfg="$(ls -t ~/Library/Preferences/Ableton/Live\ */Library.cfg 2>/dev/null | head -1 || true)"
if [ -n "$cfg" ]; then
	p="$(sed -n 's/.*<ProjectPath Value="\([^"]*\)".*/\1/p' "$cfg" | head -1)"
	if [ -n "$p" ] && [ -d "$p/User Library" ]; then
		user_lib="$p/User Library"
	elif [ -n "$p" ] && [ -d "$p" ]; then
		user_lib="$p"
	fi
fi
[ -n "$user_lib" ] || user_lib="$HOME/Music/Ableton/User Library"
if [ ! -d "$user_lib" ]; then
	echo "Ableton User Library not found ($user_lib). Is Live installed?" >&2
	exit 1
fi

dest="$user_lib/Max For Live/$device_name"
rm -rf "$dest"
mkdir -p "$dest"

# Each .amxd is self-contained: the UI rides inside it as a payload in wrapper.js.
for f in "$src"/*.amxd; do
	cp "$f" "$dest/"
	echo "  installed $(basename "$f")"
done

# Presets (hand-saved Live racks, packaged next to the devices by the build) go in
# the same folder, so a rack that names these devices finds them one drag away.
for f in "$src"/*.adg "$src"/*.adv; do
	[ -e "$f" ] || continue
	cp "$f" "$dest/"
	echo "  installed $(basename "$f") (preset)"
done

# A `site:` window's content is a whole prebuilt site - too big to ride inside the
# .amxd as a payload - so it ships as a folder NEXT TO the device and has to be
# installed with it. Without the folder the device still plays; that window opens
# empty, and the wrapper says so in the Max console.
for d in "$src"/*-site; do
	[ -d "$d" ] || continue
	cp -R "$d" "$dest/"
	echo "  installed $(basename "$d")/ (site sidecar)"
done

echo "Installed to $dest"
echo "In Live: User Library > Max For Live > $device_name"
echo "NOTE: Live embeds a copy of the device in the set. Instances already"
echo "      on a track will NOT update - delete and re-drag them."
