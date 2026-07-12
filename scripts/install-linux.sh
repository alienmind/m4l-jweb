#!/usr/bin/env bash
# install-linux.sh - copy the built devices into an Ableton User Library that
# lives under a Wine prefix (Live has no native Linux build).
#
# Point ABLETON_USER_LIBRARY at your User Library to skip the guessing, e.g.
#   ABLETON_USER_LIBRARY="$HOME/.wine/drive_c/users/$USER/Documents/Ableton/User Library" \
#     scripts/install-linux.sh
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

user_lib="${ABLETON_USER_LIBRARY:-}"
if [ -z "$user_lib" ]; then
	for candidate in \
		"$HOME/.wine/drive_c/users/$USER/Documents/Ableton/User Library" \
		"$HOME/.wine/drive_c/users/$USER/My Documents/Ableton/User Library" \
		"$HOME/Documents/Ableton/User Library"; do
		if [ -d "$candidate" ]; then
			user_lib="$candidate"
			break
		fi
	done
fi
if [ -z "$user_lib" ] || [ ! -d "$user_lib" ]; then
	echo "Ableton User Library not found. Set ABLETON_USER_LIBRARY to its path." >&2
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
