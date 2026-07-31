# Pass runner context as a JSON file

Runner invocations will receive structured channel context through a temporary JSON context file whose path is exposed in the `AP_CONTEXT_FILE` environment variable. This avoids command-line length limits and shell quoting bugs, works for custom commands, and makes failed runner invocations easier to inspect. Standard input may carry the triggering message body as a convenience, but the context file is the authoritative input.
