# KDL test fixtures

Input for the round-trip tests: a configuration is parsed, converted to the
typed model, and written back out. Nothing may be lost on the way, and the
result has to be a file niri still accepts.

| Fixture | What it covers | `niri validate` |
| --- | --- | --- |
| `default.kdl` | The configuration niri ships with, copied verbatim. The baseline for a load/save round-trip. | passes |
| `with-comments.kdl` | A deliberately messy single file: `//` and `/* */` comments, trailing comments, blank lines, mixed indentation, quoted and raw strings. Nothing here should be reformatted. | passes |
| `commented-out.kdl` | Nodes hidden behind `/-`. niri ignores them, so a round-trip that quietly drops them looks like a success. They have to come back unchanged. | passes |
| `unknown-blocks.kdl` | Blocks and options niri does not know. | **fails on purpose** (see below) |
| `multi-file/` | One main file and four includes, all in `includes/`. Each include is a valid config on its own, so the test also covers parsing a fragment that is not the entry point. | passes |
| `cachyos-style/` | Includes spread over `cfg/`, with `cfg/display.kdl` pulling in `cfg/panel/monitors.kdl`, which in turn pulls in two more files under `cfg/panel/profiles/`. Exercises relative paths that go up and back down. | passes |
| `noctalia-style/` | `include optional=true`, including a `cfg/absent.kdl` that is not in the tree. niri prints a warning and carries on. | passes, with a warning |

## Why `unknown-blocks.kdl` does not validate

It is not a niri configuration. The blocks in it are made up on purpose, and
niri refuses to load the file. The KDL engine still has to open it, keep every
node in place, and save it unchanged, which is what the test is for. Keep this
file out of any check that expects every fixture to validate.

Reading the error messages is a quick way to tell a genuine syntax problem
from a node niri simply does not know: schema errors arrive one per node as
`unexpected node` or `unexpected property`, while a syntax error stops the
parse with a different message and a span pointing into the file.

## Notes for whoever writes the tests

- `default.kdl` is the unmodified file from the niri package, so updating it
  means re-copying from a release rather than editing it.
- Everything else is synthetic. Output names, hotkeys and paths are made up.
- `noctalia-style/cfg/absent.kdl` is meant to be missing. Do not add it.
- A node name starting with `#` is a valid identifier, not a comment. Both `#`
  and `/-` have shown up in real configs, and a parser that guesses will get
  this wrong.
- A bare child inside a one-line block needs an explicit terminator:
  `border { off; }` parses, `border { off }` does not.
- `/-` takes no `-/` terminator. Each one hides exactly one node, so two
  disabled children need two of them.
