"""Validate the pinned court with the installed official GenVM linter."""
import ast
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "quality_court.py"
RUNNER = "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"
BUNDLE_VERSION = "v0.3.0-rc7"
LINTER_VERSION = "0.11.0"


def main() -> int:
    source = CONTRACT.read_text(encoding="utf-8")
    first_line = source.splitlines()[0] if source else ""
    try:
        header = json.loads(first_line.removeprefix("#").strip())
    except ValueError:
        print("Contract must start with its pinned Depends header.", file=sys.stderr)
        return 1
    if header != {"Depends": RUNNER}:
        print("Unexpected GenVM runner dependency.", file=sys.stderr)
        return 1
    if "py-genlayer:test" in source or "py-genlayer:latest" in source:
        print("Local-only GenVM runner aliases are forbidden.", file=sys.stderr)
        return 1

    try:
        ast.parse(source, filename=str(CONTRACT))
    except SyntaxError:
        print("Contract contains invalid Python syntax.", file=sys.stderr)
        return 1

    local_python = ROOT / ".venv" / "bin" / "python"
    python = str(local_python) if local_python.is_file() else sys.executable
    version_check = subprocess.run(
        [
            python,
            "-c",
            "from importlib.metadata import version; "
            f"raise SystemExit(0 if version('genvm-linter') == '{LINTER_VERSION}' else 1)",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if version_check.returncode != 0:
        print(
            f"Install genvm-linter=={LINTER_VERSION} in the project .venv.",
            file=sys.stderr,
        )
        return 1

    result = subprocess.run(
        [python, "-m", "genvm_linter.cli", "check", str(CONTRACT), "--json"],
        cwd=ROOT,
        env={**os.environ, "GENVM_VERSION": BUNDLE_VERSION},
        check=False,
    )
    if result.returncode == 0:
        print("Contract checks passed")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
