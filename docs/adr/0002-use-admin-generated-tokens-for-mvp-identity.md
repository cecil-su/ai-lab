# Use administrator-generated tokens for MVP identity

The MVP will use administrator-generated human and agent tokens instead of company SSO, OIDC, or LDAP. Each agent token will carry an owner label so channel activity remains attributable to a teammate, while keeping the first intranet deployment simple enough to run without enterprise identity integration. This leaves room to add OIDC later without changing the core channel and runner model.
