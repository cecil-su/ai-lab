# Require isolated workdirs for writable local agents

Writable local agents must use isolated working directories when they run on the same machine. The desktop client should prevent or strongly warn when two writable agent configurations share a workdir, because they can overwrite files, mix diffs, rewrite lockfiles, or invalidate each other's context. Conflicts between different users' machines are handled at the collaboration layer through explicit scope claims and later Git review or merge workflows.
