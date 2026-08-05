#!/usr/bin/env bash
# install-mac.sh - copy the built devices into the Ableton User Library
# (Max For Live/m4l-jweb), replacing any previous install.
#
# The User Library path is read from the newest Live preferences file
# (~/Library/Preferences/Ableton/Live */Library.cfg, <ProjectPath>); Live's
# default locations are the fallback, and a third argument overrides both. Every
# step of that search is printed: this script has to GUESS (Live's own config is the
# only thing that knows), and a wrong guess is indistinguishable from a broken
# install unless it says what it read and what it chose.
#
# The folder of devices is FOUND (the one beside this script holding `.amxd`
# files), so the unzipped release installs itself with no arguments. `m4l-jweb
# install` passes the name and the folder explicitly, and those win.
#
# RUN IT AS `bash install-mac.sh`. A zip unpacked by Archive Utility does not
# reliably keep the executable bit, and `./install-mac.sh` then fails with
# "permission denied" - which reads as a broken download rather than a file mode.
#
# usage: bash install-mac.sh [device-name] [src-dir] [user-library]
# `m4l-jweb install` passes the first two; standalone (from the zip) both are
# inferred. The third overrides the User Library search entirely.
set -euo pipefail
device_name="${1:-}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="${2:-}"

# WHERE THE DEVICES ARE. The name used to DEFAULT to this library's own
# ("m4l-jweb"), which is right in this repo and wrong in every consumer's release:
# the zip holds `m4l-gugelhupf/`, the script looked for `m4l-jweb/`, and a user who
# had unzipped a perfectly good build was told to go and run `pnpm build`.
#
# So the folder is DISCOVERED rather than assumed - it is the one next to this
# script with `.amxd` files in it - and the device name comes from what was found.
# The named form still wins when `m4l-jweb install` passes it.
if [ -z "$src" ] && [ -n "$device_name" ]; then
	for c in "$here/$device_name" "$(dirname "$here")/dist/$device_name"; do
		if compgen -G "$c/*.amxd" > /dev/null 2>&1; then
			src="$c"
			break
		fi
	done
fi
if [ -z "$src" ]; then
	# Next to this script covers the unzipped release AND dist/ after a build;
	# ../dist/* covers running it straight out of a repo checkout.
	found_count=0
	for c in "$here"/*/ "$(dirname "$here")"/dist/*/; do
		[ -d "$c" ] || continue
		compgen -G "$c*.amxd" > /dev/null 2>&1 || continue
		src="${c%/}"
		found_count=$((found_count + 1))
	done
	if [ "$found_count" -gt 1 ]; then
		echo "More than one folder of devices here. Name the one you want:" >&2
		echo "  bash $(basename "$0") <folder-name>" >&2
		exit 1
	fi
fi
if [ -z "$src" ] || ! compgen -G "$src/*.amxd" > /dev/null 2>&1; then
	echo "No .amxd found. Looked next to this script ($here) and in $(dirname "$here")/dist/." >&2
	echo "From the release zip, run this script where you unzipped it - the devices are in the folder beside it." >&2
	exit 1
fi
# The folder's own name is the name the User Library gets, so a repo scaffolded
# under any name installs under that name without being told what it is.
device_name="${device_name:-$(basename "$src")}"

# An explicit third argument beats the search below - the escape hatch for a library
# this cannot know about.
user_lib="${3:-}"
cfg=""
[ -n "$user_lib" ] || cfg="$(ls -t ~/Library/Preferences/Ableton/Live\ */Library.cfg 2>/dev/null | head -1 || true)"
if [ -n "$cfg" ]; then
	echo "  Live preferences: $cfg"
	p="$(sed -n 's/.*<ProjectPath Value="\([^"]*\)".*/\1/p' "$cfg" | head -1)"
	echo "  ProjectPath: ${p:-(not in that file)}"
	if [ -n "$p" ] && [ -d "$p/User Library" ]; then
		user_lib="$p/User Library"
	elif [ -n "$p" ] && [ -d "$p" ]; then
		user_lib="$p"
	fi
elif [ -z "$user_lib" ]; then
	echo "  Live preferences: none found under ~/Library/Preferences/Ableton"
fi
# Live's own default, and the place a Live that has never been configured puts it.
if [ -z "$user_lib" ]; then
	for c in "$HOME/Music/Ableton/User Library" "$HOME/Documents/Ableton/User Library"; do
		# `[ -d "$c" ] && user_lib=...` would be the last command of this body, and a
		# failing test there exits the whole script under `set -e`.
		if [ -d "$c" ]; then
			user_lib="$c"
			break
		fi
	done
fi
if [ -z "$user_lib" ] || [ ! -d "$user_lib" ]; then
	echo "Ableton User Library not found. Tried Live's preferences, ~/Music/Ableton/User Library" >&2
	echo "and ~/Documents/Ableton/User Library. Pass the folder yourself:" >&2
	echo "  bash install-mac.sh $device_name \"$src\" \"/path/to/User Library\"" >&2
	exit 1
fi
echo "  User Library: $user_lib"

dest="$user_lib/Max For Live/$device_name"
# The folder is NOT wiped first. It is the same folder the devices SAVE INTO - exports,
# downloaded samples, anything a user dragged out of it - so clearing it to get a clean
# install threw away their work. Overwrite what this build produces; leave the rest.
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
	# This one IS replaced wholesale: it is entirely build output, and a file dropped
	# from the site between builds would otherwise linger and be served.
	rm -rf "$dest/$(basename "$d")"
	cp -R "$d" "$dest/"
	echo "  installed $(basename "$d")/ (site sidecar)"
done

# The manual and anything else the release carries for a person rather than for Max.
for f in "$src"/*.pdf "$src"/*.md; do
	[ -e "$f" ] || continue
	cp "$f" "$dest/"
	echo "  installed $(basename "$f") (doc)"
done

# GATEKEEPER. Anything that arrived in a downloaded zip carries com.apple.quarantine,
# and it is carried by every file inside - the .amxd Live has to load and the hundreds
# of files in a site sidecar that Chromium has to read. Stripping it is the documented
# way to say "I chose to run this"; it is a no-op on files that were never quarantined,
# and `xattr` is missing on nothing this can run on, so the failure is tolerated rather
# than reported.
if command -v xattr > /dev/null 2>&1; then
	xattr -dr com.apple.quarantine "$dest" 2> /dev/null || true
	echo "  cleared macOS quarantine on $dest"
fi

echo "Installed to $dest"
echo "It now holds:"
ls -la "$dest"
echo "In Live: User Library > Max For Live > $device_name"
echo "NOTE: Live embeds a copy of the device in the set. Instances already"
echo "      on a track will NOT update - delete and re-drag them."
