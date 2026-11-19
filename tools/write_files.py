#!/usr/bin/env python3
"""Write reviewed project files from a JSON object on stdin, within this repo only."""
import json, os, pathlib, sys, tempfile
ROOT = pathlib.Path(__file__).resolve().parents[1]
def main():
    payload = json.loads(sys.stdin.readline())
    files = payload["files"]
    if not isinstance(files, dict) or len(files) > 100:
        raise ValueError("Expected a bounded file mapping")
    for name, content in files.items():
        path = pathlib.PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or not path.parts:
            raise ValueError("Unsafe path")
        if path.parts[0] in (".git", ".vercel") or (name.startswith(".env") and name != ".env.example"):
            raise ValueError("Private state is not accepted")
        if name == "tools/write_files.py" or not isinstance(content, str):
            raise ValueError("Protected helper or invalid content")
        target = ROOT.joinpath(*path.parts)
        if not target.resolve().is_relative_to(ROOT):
            raise ValueError("Path leaves the project")
        cursor = ROOT
        for part in path.parts:
            cursor = cursor / part
            if cursor.is_symlink():
                raise ValueError("Symlinks are not accepted")
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=target.parent, delete=False) as stream:
            stream.write(content)
            temporary = stream.name
        os.replace(temporary, target)
        print(name)
if __name__ == "__main__":
    main()
