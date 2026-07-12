#!/usr/bin/env bash
# install-mac.sh - copy the built devices into the Ableton User Library
# (Max For Live/m4l-jweb), replacing any previous install.
#
# The User Library path is read from the newest Live preferences file
# (~/Library/Preferences/Ableton/Live */Library.cfg, <ProjectPath>); Live's
# default location is the fallback.
set -euo pipefail
device_name="m4l-jweb"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source: ./m4l-jweb next to this script (zip layout) or ../dist/m4l-jweb (repo layout).
src="$here/$device_name"
[ -d "$src" ] || src="$(dirname "$here")/dist/$device_name"
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

echo "Installed to $dest"
echo "In Live: User Library > Max For Live > $device_name"
echo "NOTE: Live embeds a copy of the device in the set. Instances already"
echo "      on a track will NOT update - delete and re-drag them."
