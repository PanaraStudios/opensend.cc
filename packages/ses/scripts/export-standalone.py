#!/usr/bin/env python3
"""Extract only the reviewed SES package, with no starter-kit application or secrets.

Example (from the starter repository root):
  python3 packages/ses/scripts/export-standalone.py --output /tmp/opensend-convex-ses

This prepares a standalone source directory. It does not create/publish a GitHub
repository, register an npm scope, modify the original component, or deploy code.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

DIRECTORIES = ("src", "example", "scripts")
FILES = ("LICENSE", "README.md", "RUNBOOK.md", "REVIEW.md", "OPENSEND.md", "CHANGELOG.md", "convex.json", "eslint.config.js", "vitest.config.ts", "tsconfig.json", "tsconfig.build.json", "tsconfig.test.json", ".gitignore")
EXCLUDED = {"node_modules", "dist", ".git", "__pycache__", ".convex", ".cache"}


def standalone_lock(lock_text):
    """Retain the installed resolution graph, but only the SES importer."""
    header, rest = lock_text.split("importers:\n", 1)
    importers, graph = rest.split("\npackages:\n", 1)
    match = re.search(r"^  packages/ses:\n(.*?)(?=^  [^ ]|\Z)", importers, re.M | re.S)
    if not match:
        raise ValueError("Cannot find packages/ses importer in the starter lockfile")
    return header + "importers:\n\n  .:\n" + match.group(1).rstrip() + "\n\npackages:\n" + graph


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--package-name", default="@opensend/convex-ses")
    args = parser.parse_args()
    if not re.fullmatch(r"(?:@[a-z0-9-]+/)?[a-z0-9][a-z0-9._-]*", args.package_name):
        parser.error("Invalid npm package name")
    source = Path(__file__).resolve().parents[1]
    destination = args.output.resolve()
    if destination == source or source in destination.parents:
        parser.error("Output must be outside the source package")
    if destination.exists():
        parser.error("Output already exists; choose a new directory")
    lock = standalone_lock((source.parents[1] / "pnpm-lock.yaml").read_text())
    destination.mkdir(parents=True)
    hashes = {}
    for name in FILES:
        path = source / name
        if path.is_file():
            shutil.copy2(path, destination / name)
            hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    for directory in DIRECTORIES:
        for path in (source / directory).rglob("*"):
            relative = path.relative_to(source)
            if not path.is_file() or path.is_symlink() or any(p in EXCLUDED or p.startswith(".env") for p in relative.parts):
                continue
            if path.suffix in (".pyc", ".tgz", ".tsbuildinfo"):
                continue
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            hashes[str(relative)] = hashlib.sha256(path.read_bytes()).hexdigest()
    package = json.loads((source / "package.json").read_text())
    previous_name = package["name"]
    package.update(name=args.package_name, private=True, homepage="https://opensend.cc", packageManager="pnpm@9.12.2")
    package.pop("repository", None)
    package.pop("bugs", None)
    (destination / "package.json").write_text(json.dumps(package, indent=2) + "\n")
    for path in destination.rglob("*"):
        if path.is_file() and path.suffix in (".ts", ".js", ".md", ".json"):
            path.write_text(path.read_text().replace(previous_name, args.package_name))
    (destination / "pnpm-lock.yaml").write_text(lock)
    (destination / "pnpm-workspace.yaml").write_text("packages:\n  - '.'\n")
    (destination / "EXTRACTION.json").write_text(json.dumps({
        "sourcePackage": previous_name, "targetPackage": args.package_name,
        "sourceSha256": hashes,
        "notes": ["Package name is proposed; npm availability has not been checked.", "private=true prevents accidental publication. Review metadata and attribution before release.", "Only SES package source was extracted; OpenSend service and dashboard are not implemented here."],
    }, indent=2) + "\n")
    (destination / "README.md").write_text("# OpenSend SES engine — standalone extraction\n\nThis is the reviewed sending component, ready to move into an OpenSend repository built from k4stack. It is not yet the OpenSend HTTP service or dashboard. See OPENSEND.md for that product boundary.\n\nVerify locally: `pnpm install --frozen-lockfile && pnpm run verify`. Live AWS acceptance remains described in RUNBOOK.md.\n\n" + (destination / "README.md").read_text())
    print(f"Extracted {len(hashes)} source files into {destination}")
    print("Original starter-kit files were preserved. No repository was published.")


if __name__ == "__main__":
    main()
