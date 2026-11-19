import json, os, pathlib, sys
if sys.stdin.isatty():
    import termios
    settings = termios.tcgetattr(sys.stdin.fileno())
    settings[3] &= ~termios.ECHO
    termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, settings)
value = sys.stdin.readline().strip()
if not value or len(value) > 512:
    raise ValueError("Invalid model credential")
directory = pathlib.Path.home() / ".config" / "agent-refund-court"
directory.mkdir(parents=True, exist_ok=True, mode=0o700)
target = directory / "model.json"
with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as stream:
    json.dump({"provider":"gemini","model":"gemini-3.1-flash-lite","apiKey":value}, stream)
os.chmod(target, 0o600)
print("Gemini credential stored privately.")
