#!/usr/bin/env python3
"""Packages the project (sources, docs, PDFs) into a ZIP, excluding build output, dependencies, local state and secrets.

Usage: python scripts/make-zip.py <output.zip>
"""
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCLUDED_DIRS = {"node_modules", "target", "dist", ".angular", ".run", ".work", ".claude", ".git", "coverage", "out-tsc", ".idea", ".vscode", "__pycache__"}
EXCLUDED_SUFFIXES = (".log", ".zip", ".hprof", ".pid", ".iml")
EXCLUDED_NAMES = {".env", ".DS_Store", "Thumbs.db"}
TOP = "ssnc-fintech-platform"


def main():
    out = os.path.abspath(sys.argv[1])
    count = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for base, dirs, files in os.walk(ROOT):
            dirs[:] = sorted(d for d in dirs if d not in EXCLUDED_DIRS)
            for f in sorted(files):
                if f in EXCLUDED_NAMES or f.endswith(EXCLUDED_SUFFIXES) or (f.startswith(".env") and f != ".env.example"):
                    continue
                full = os.path.join(base, f)
                if os.path.abspath(full) == out:
                    continue
                z.write(full, os.path.join(TOP, os.path.relpath(full, ROOT)).replace(os.sep, "/"))
                count += 1
    print(f"{count} files -> {out} ({os.path.getsize(out) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
