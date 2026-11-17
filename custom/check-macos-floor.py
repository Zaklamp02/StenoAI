"""Refuse an app whose binaries need a newer macOS than it says it supports.

    python3 -I custom/check-macos-floor.py /path/to/StenoAI.app

Every Mach-O file in the bundle carries the oldest macOS it loads on (`minos`).
Anything built on the release Mac with that Mac's defaults (a Homebrew Python
bottle, a wheel pip picked for the newest macOS) inherits the release Mac's own
version, and the app then dies at launch on every older Mac with
"Symbol not found ... built for macOS NN which is newer than running OS".
The floor is the app's own LSMinimumSystemVersion, so the check follows it.
"""

import os
import plistlib
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

MACHO_MAGICS = {
    b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe",  # 32-bit
    b"\xfe\xed\xfa\xcf", b"\xcf\xfa\xed\xfe",  # 64-bit
    b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf",  # universal
}


def version(text):
    return tuple(int(part) for part in text.split("."))


def is_macho(path):
    try:
        with open(path, "rb") as handle:
            return handle.read(4) in MACHO_MAGICS
    except OSError:
        return False


def required_macos(path):
    """Highest minimum macOS across the file's slices, or None if it has none."""
    out = subprocess.run(
        ["vtool", "-show-build", path], capture_output=True, text=True, check=False
    ).stdout
    found = []
    in_version_min = False
    for line in out.splitlines():
        words = line.split()
        if len(words) == 2 and words[0] == "cmd":
            in_version_min = words[1] == "LC_VERSION_MIN_MACOSX"
        elif len(words) == 2 and (words[0] == "minos" or (in_version_min and words[0] == "version")):
            found.append(version(words[1]))
    return max(found) if found else None


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: check-macos-floor.py /path/to/App.app")
    app = sys.argv[1].rstrip("/")
    with open(os.path.join(app, "Contents", "Info.plist"), "rb") as handle:
        floor_text = plistlib.load(handle)["LSMinimumSystemVersion"]
    floor = version(floor_text)

    files = [
        os.path.join(root, name)
        for root, _dirs, names in os.walk(app)
        for name in names
        if not os.path.islink(os.path.join(root, name))
    ]
    machos = [path for path in files if is_macho(path)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(zip(machos, pool.map(required_macos, machos)))

    too_new = sorted(
        (need, os.path.relpath(path, app))
        for path, need in results
        if need is not None and need > floor
    )
    if too_new:
        print(
            f"{len(too_new)} of {len(machos)} binaries need a newer macOS than the app's "
            f"minimum ({floor_text}); it would not start there:",
            file=sys.stderr,
        )
        for need, rel in too_new[:25]:
            print(f"  macOS {'.'.join(map(str, need))}  {rel}", file=sys.stderr)
        if len(too_new) > 25:
            print(f"  ... and {len(too_new) - 25} more", file=sys.stderr)
        sys.exit(1)
    print(f"All {len(machos)} binaries load on macOS {floor_text}.")


if __name__ == "__main__":
    main()
