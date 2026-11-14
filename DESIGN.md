# Toolsmith — Design and Interface Conventions

## Scope

Toolsmith is a runtime/server project, not the Toolsmith Console dashboard frontend. The full dashboard UI lives in the separate toolsmith-console repository. This guide applies to user-facing interfaces that Toolsmith itself serves or exposes, such as the OAuth authorization/login page, and to the shape and consistency of its API responses.

## Interface principles

- Keep runtime interfaces focused, predictable, and operationally clear.
- Prefer concise labels, explicit states, and actionable error messages.
- Distinguish authentication, authorization, approval, and execution failures.
- Do not claim an operation succeeded until the backend confirms it.
- Avoid leaking credentials, access tokens, OAuth codes, collaboration URLs, or other sensitive values into UI output and logs.

## Hosted OAuth page

- Maintain the existing dark/light theme toggle and operating-system theme default.
- Keep form controls, buttons, validation messages, and loading/disabled states consistent.
- Make the requested client/application and authorization decision understandable before a user grants access.
- Show failures in a recoverable, concise way without exposing internal stack traces or secrets.
- Keep authentication state separate from Toolsmith Console browser sessions. OAuth credentials authorize MCP clients; they do not create an Toolsmith Console dashboard session.

## API consistency

- Return predictable JSON response shapes and meaningful HTTP status codes.
- Validate external input at the boundary before passing it to runtime operations.
- Keep authentication requirements explicit for each route.
- Avoid exposing secret-bearing internal configuration in API responses.
- Preserve streaming semantics for SSE and MCP Streamable HTTP endpoints.
- Keep tool metadata and permission states consistent with the actual runtime enforcement.

## Permission and safety UX

- Tool exposure and permission configuration are operational controls, not decorative UI states.
- Clearly distinguish allow, require-approval, and block outcomes.
- Custom rules should describe their conditions, match behavior (all/any), matching action, and fallback action without ambiguity.
- Root-command rules are high risk: present their enabled/disabled state clearly, use exact command and argument matching, and do not imply that shell chaining or wildcard expansion is supported.
- Seeded systemctl examples must remain disabled by default.

## Ownership

- Toolsmith owns the runtime tool catalog, tool execution enforcement, custom permission rules, approval state, host operations, terminals, and tunnel lifecycle.
- Toolsmith Console consumes Toolsmith APIs and presents those controls in the dashboard.
- Shared visual changes to the Toolsmith Console dashboard should be made in the toolsmith-console repository and follow its `DESIGN.md`.

## Review checklist

- [ ] Authentication and authorization states are distinguishable.
- [ ] Sensitive values are not returned or logged.
- [ ] Permission state shown to the user matches backend enforcement.
- [ ] Loading, empty, error, and success responses are handled.
- [ ] Theme and keyboard behavior remain usable where a UI is involved.
- [ ] API behavior and relevant README documentation are updated.
