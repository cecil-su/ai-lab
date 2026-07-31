# Normalize runner output through adapters

The desktop core will not require every runner CLI to emit the same JSON format. Each runner adapter will translate tool-specific stdout, stderr, exit codes, session identifiers, and optional structured output into a normalized RunnerResult. The custom command runner's default contract is exit code plus stdout as draft reply body, while first-class runners may use stronger structured parsing and degrade to a readable draft when parsing fails.
