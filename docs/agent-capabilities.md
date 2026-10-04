# XR Shell agent capabilities

XR Shell has two agent entry points: its built-in command deck and the local MCP server at `mcp/server.js`. The command deck runs Codex or Cursor in read-only mode and passes a limited set of XR actions to the host. An external IDE agent uses the MCP tools directly and may also have its own file-editing and terminal tools. XR Shell itself does not grant an agent general shell access or permission to edit files.

| Use case | Agent request or MCP tools | Result |
| --- | --- | --- |
| Discover the workspace | `xr_shell_list_apps`, `xr_shell_get_layout` | Inspect available windows, captured surfaces, XR dimensions, and placement. |
| Bring in apps | `xr_shell_pull_app`, `xr_shell_launch_app` | Capture an existing window or launch a `.app` and attach its window. |
| Arrange apps | `xr_shell_focus_app`, `xr_shell_transform_app`, `xr_shell_release_app`, `xr_shell_open_layout` | Focus, move, resize, release, or open a multi-app layout. |
| Add spatial information | `xr_shell_add_note`, `xr_shell_a2ui_apply` | Create draggable, closable notes and custom widgets. Widgets can be saved to the local library. |
| Observe widget interaction | `xr_shell_a2ui_capabilities`, `xr_shell_a2ui_events`, `xr_shell_a2ui_delete` | Discover supported components, read explicit user events, or remove a surface. |
| Track a local script | `xr_shell_progress_prepare`, `xr_shell_progress_get`, `xr_shell_progress_configure` | Show remaining runs, ETA, and metrics; the script reports over a separate local socket. |
| Run a script or CLI command | `xr_shell_run_script`, `xr_shell_script_status` | Approve and launch an exact script or a regular executable with separate arguments, with or without progress. Run in the background or an attached macOS Terminal window. |

Examples you can ask the XR Shell agent:

- “Open Terminal and Calculator side by side, then move Calculator slightly closer.”
- “Add a floating note with the deployment checklist.”
- “Create a widget for `/absolute/path/to/import.py` with an input field, a mode picker, a dry-run checkbox, and a Run button. Use job ID `data_import` and show remaining runs.”
- “Prepare a progress widget for `data_import`, then run `/absolute/path/to/import.py` with `--mode fast`.”
- “Run `/absolute/path/to/report.py --help` in the background without a progress widget.”
- “Run `/absolute/path/to/report.py` in Terminal and attach its window to XR Shell; no progress widget.”
- “Run `git status` in `/absolute/project/path` in the background, without a progress widget.”

The built-in agent can create widgets, arrange windows, prepare progress displays, and launch local scripts or CLI executables. It cannot edit files, inject shell expressions or pipelines, or automatically instrument a script. A CLI tool may itself modify files, so check the exact executable, arguments, and working directory in the required approval dialog. Use an IDE agent for code edits. Generated widget buttons can call only XR Shell's local allowlisted actions; they are not unrestricted MCP clients.

## Script-control widget

This A2UI message batch can be passed as `messages` to `xr_shell_a2ui_apply`. Replace the example script path with an existing local script that reports progress through `bin/xr-shell-progress.js`. The widget is draggable and closable, and its header has **Save** for the widget library.

```json
[
  {
    "version": "v0.9.1",
    "createSurface": {
      "surfaceId": "import_control",
      "catalogId": "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"
    }
  },
  {
    "version": "v0.9.1",
    "updateComponents": {
      "surfaceId": "import_control",
      "components": [
        { "id": "root", "component": "Card", "child": "fields" },
        { "id": "fields", "component": "Column", "children": ["heading", "input", "mode", "dry", "display", "run"] },
        { "id": "heading", "component": "Text", "variant": "h2", "text": "Import control" },
        { "id": "input", "component": "TextField", "label": "Input file", "value": { "path": "/input" } },
        { "id": "mode", "component": "Select", "label": "Mode", "value": { "path": "/mode" }, "options": [
          { "label": "Fast", "value": "fast" },
          { "label": "Careful", "value": "careful" }
        ] },
        { "id": "dry", "component": "Checkbox", "label": "Dry run", "value": { "path": "/dryRun" } },
        { "id": "display", "component": "Select", "label": "Show output", "value": { "path": "/display" }, "options": [
          { "label": "In XR Terminal", "value": "terminal" },
          { "label": "Background", "value": "background" }
        ] },
        { "id": "run", "component": "Button", "label": "Run import", "action": { "event": {
          "name": "mcp.call",
          "context": { "tool": "xr_shell_run_script", "arguments": {
            "jobId": "data_import",
            "title": "Data import",
            "scriptPath": "/absolute/path/to/import.py",
            "display": { "path": "/display" },
            "args": ["--input", { "path": "/input" }, "--mode", { "path": "/mode" }, { "value": "--dry-run", "when": { "path": "/dryRun" } }]
          } }
        } } }
      ]
    }
  },
  {
    "version": "v0.9.1",
    "updateDataModel": { "surfaceId": "import_control", "value": { "input": "", "mode": "fast", "dryRun": false, "display": "terminal" } }
  }
]
```

Text fields and selectors supply string arguments. A checkbox can conditionally include a fixed flag through the `when` field. XR Shell validates the script path and arguments and shows the native approval dialog. The Run button does not require an agent turn; the widget's progress updates also do not require agent turns. Omit `jobId` and `title` from a widget for a script that does not report progress.

## Boundaries

- XR Shell MCP is local-only; it does not open a TCP port. Script progress uses its own user-only Unix socket.
- Launching a macOS `.app` is distinct from launching a script or CLI executable. Scripts are limited to the supported extensions; CLI commands resolve to an executable file and do not evaluate shell syntax. Both always ask for approval. Terminal mode uses an XR Shell-generated temporary `.command` launcher, so arguments are individually quoted rather than interpolated as an arbitrary command string.
- A script runs from its own directory with the current macOS user's permissions. If it uses a progress widget, it should send `start`, `update`, and `finish` through the progress CLI; XR Shell does not infer loop progress from process output. Terminal output stays in Terminal; background output is available from `xr_shell_script_status`.
- The shared macOS menu and app input are interactive UI features, not general-purpose MCP tools for agent automation.
