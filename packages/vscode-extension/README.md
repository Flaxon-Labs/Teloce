# Teloce VS Code Extension




<p align="center">
  <img src="https://raw.githubusercontent.com/aldanedev-create/telonce/main/assets/telonce.png" alt="telonce logo "
   width="200"/>
</p>



**Author:** Aldane Hutchinson

 teloce:  A JavaScript template engine for Python web developers.

> Teloce template language support for Visual Studio Code.

The Teloce VS Code extension provides language support and developer tooling for Teloce templates (`.vel` files), including syntax highlighting, diagnostics, autocomplete, formatting, snippets, and debugger integration.

---

## Features

* **🔍 Syntax Highlighting** — Full syntax highlighting for Teloce templates.
* **📋 Diagnostics** — Real-time validation and error detection.
* **💡 Autocomplete** — Smart completions for directives, events, bindings, and variables.
* **📝 Hover Information** — Documentation and information on hover.
* **🎨 Formatting** — Automatically format Teloce templates.
* **🧩 Snippets** — Useful snippets for common Teloce patterns.
* **📊 Symbol Support** — Document outline and component symbols.
* **🐛 Debugger Integration** — Open and inspect applications using the Teloce debugger.

---

## Installation

### From the VS Code Marketplace

1. Open Visual Studio Code.
2. Press `Ctrl+Shift+X` on Windows/Linux or `Cmd+Shift+X` on macOS.
3. Search for **Teloce**.
4. Click **Install**.

### From a VSIX File

```bash
code --install-extension teloce-vscode.vsix
```

---

## Usage

### Creating a `.vel` File

Create a new file with the `.vel` extension:

```html
<!-- Component.vel -->
<template>
  <div class="card">
    <h2>{{ title }}</h2>
    <p>{{ content }}</p>
    <button @click="handleClick">Click me</button>
  </div>
</template>

<script>
export default {
  name: 'MyComponent',

  data() {
    return {
      title: 'Hello World',
      content: 'This is a Teloce component'
    };
  },

  methods: {
    handleClick() {
      alert('Clicked!');
    }
  }
};
</script>

<style scoped>
.card {
  padding: 20px;
  border: 1px solid #ccc;
}
</style>
```

Once the file is opened, the extension automatically provides Teloce language features.

---

## Commands

| Command               | Description                   | Keybinding    |
| --------------------- | ----------------------------- | ------------- |
| `teloce.format`       | Format a Teloce template      | `Shift+Alt+F` |
| `teloce.validate`     | Validate the current template | —             |
| `teloce.openDebugger` | Open the Teloce debugger      | —             |

---

## Settings

| Setting                    |     Default | Description                           |
| -------------------------- | ----------: | ------------------------------------- |
| `teloce.format.indentSize` |         `2` | Number of spaces used for indentation |
| `teloce.format.useTabs`    |     `false` | Use tabs instead of spaces            |
| `teloce.validate.enable`   |      `true` | Enable template validation            |
| `teloce.completion.enable` |      `true` | Enable autocomplete                   |
| `teloce.debugger.host`     | `localhost` | Teloce debugger host                  |
| `teloce.debugger.port`     |      `9000` | Teloce debugger port                  |

---

## Contributing

### Development

Clone the repository and install its dependencies:

```bash
# Clone the repository
git clone https://github.com/aldane-dev-create/teloce.git

# Enter the repository
cd teloce

# Install dependencies
pnpm install

# Build the project
pnpm build

# Open the VS Code extension package
code packages/vscode-extension
```

Press **F5** in VS Code to launch the extension in an Extension Development Host.

---

## Publishing

### Build the Language Service

```bash
cd packages/language-service

pnpm build
pnpm publish --access public
```

### Package the VS Code Extension

```bash
cd packages/vscode-extension

pnpm build
pnpm vsce package
```

This generates a `.vsix` package that can be installed locally or uploaded to the VS Code Marketplace.

### Publish to the VS Code Marketplace

First, obtain a Personal Access Token from Azure DevOps.

Then authenticate with `vsce`:

```bash
vsce login teloce
```

Publish the extension:

```bash
pnpm vsce publish
```

---

## Local VSIX Installation

After creating the VSIX package, install it locally with:

```bash
code --install-extension teloce-vscode.vsix
```

You can also install it through VS Code:

1. Open the Extensions panel.
2. Click the **...** menu.
3. Select **Install from VSIX...**.
4. Select the generated `.vsix` file.

---

## License

MIT

## TypeScript support

Write `<script lang="ts">` in a `.vel` file, or in a component-style `.html`
file, and you get real TypeScript type-checking, hover, completion and
go-to-definition, with errors shown at the right place in your file.

```html
<script lang="ts">
export default {
  props: { title: { type: String, required: true } },
  data() { return { count: 0 }; },
  methods: {
    inc() {
      this.count = 'x';   // error: string is not assignable to number
      this.cnt;           // error: no such property
    },
  },
};
</script>
```

- `this` is typed from `props`, `data()`, `computed`, `methods` and `setup()`.
  `$`-prefixed members (`$emit`, `$refs`, `$router`, ...) are always allowed.
- `.html` files are only treated as components when they have a top-level
  `<template>` or a `<script lang="ts">` and are **not** a full page
  (`<!doctype>`, `<html>`, `<head>`, `<body>`). Flask/Django page templates are
  left alone.
- Plain `<script>` (JavaScript) blocks are not type-checked.
- A `tsconfig.json` in the workspace root is honored.

Settings: `teloce.typescript.enable` and `teloce.typescript.strict`.

Not covered yet: type-checking expressions inside `<template>`
(`{{ mesage.text }}`), and typed imports of other `.vel` components
(they import as `any`).

## Debugger

Run **Teloce: Open Debugger** from the Command Palette. The dashboard server is
built into the extension, so there is nothing else to install or start: it
starts on `teloce.debugger.host` / `teloce.debugger.port` (default
`localhost:9000`) and opens in your browser. **Teloce: Stop Debugger** shuts it
down, and it also stops when VS Code closes.

To see a page's errors in the dashboard, add one tag to the page (the command
offers to copy it, or run **Teloce: Copy Debugger Script Tag**):

```html
<script src="http://localhost:9000/client.js"></script>
```

It works in any HTML: component-style `.html` files, Flask/Django pages, or
pages built from `.vel` components. It reports uncaught errors, unhandled
promise rejections and `console.error` / `console.warn`. Each error shows the
file it came from with a **HTML** or **VEL** badge, the line and column, a plain
language title and a suggested fix. Remove the tag before shipping.

If you already run `teloce debug` from a terminal, the command opens that
dashboard instead. If the port is used by another program, you get a clear
message to change `teloce.debugger.port`.

## Which files the extension works on

- `.vel` files: everything.
- `.html` files: only **component-style** ones (a top-level `<template>` or a
  `<script lang="ts">`, and not a full page). Page shells such as Flask/Django
  templates (`<!doctype>`, `<html>`, `<body>`) are never touched.
- Formatting runs as format-document for `.vel`. For component-style `.html`
  use **Teloce: Format** (the extension does not register an `.html` formatter,
  so VS Code will not ask you to choose a default HTML formatter).
- **Teloce: Validate** checks the template and the TypeScript and opens the
  Problems panel when something is wrong.
- Settings: `teloce.validate.enable`, `teloce.completion.enable`,
  `teloce.typescript.enable`, `teloce.typescript.strict`, `teloce.format.*`,
  `teloce.debugger.host` / `port`.
