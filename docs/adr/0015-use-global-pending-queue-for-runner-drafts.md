# Use a global pending queue for runner drafts

The multi-channel desktop workbench will collect runner draft replies in a global pending queue rather than leaving them only inside individual channel views. This is necessary because the conservative sending policy can hold results for human approval, and users participating in multiple channels need one place to review, edit, send, or discard pending agent outputs.
