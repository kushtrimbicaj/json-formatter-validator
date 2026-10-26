# JSON Formatter & Validator

A fast, private JSON utility that runs entirely in your browser. Paste JSON, then format, validate, or minify it. No build step, no dependencies, no server.

## Features

- **Validate** JSON with the native `JSON.parse()`, including non-object roots (arrays, strings, numbers, booleans, and `null`).
- **Readable errors** with a plain-language summary, a line and column when the browser provides one, a fix suggestion for common mistakes (trailing commas, single quotes, unquoted keys, missing commas, comments), and a **Go to error** button.
- **Format** with 2 spaces, 4 spaces, or tabs. Changing the indent setting updates an existing formatted result.
- **Minify** to compact JSON.
- **Syntax highlighting** for keys, strings, numbers, booleans, and `null` (switched off automatically for very large output to keep the page responsive).
- **Copy** the output to the clipboard, with a fallback for browsers that restrict the Clipboard API.
- **Download** the output as `formatted.json` or `minified.json`.
- **Clear** and **Load example** controls, plus live character and line counts.
- **Keyboard shortcuts** and tooltips.
- **Accessible**: semantic HTML, labelled controls, visible focus states, status announcements through a live region, status communicated with text and icons rather than color alone, and `prefers-reduced-motion` support.
- **Responsive** two-column layout on desktop that stacks on tablets and phones.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + Enter` | Format |
| `Ctrl/Cmd + Shift + C` | Copy output (only when there is output) |
| `Esc` | Dismiss the notification |

## Technologies

- HTML5
- CSS3 (custom properties, grid, flexbox)
- Vanilla JavaScript (ES6+)

## Run locally

No installation is needed. Download or clone the repository and open `index.html` in a modern browser.

```bash
git clone https://github.com/YOUR-USERNAME/json-formatter-validator.git
cd json-formatter-validator
# Open index.html in your browser
```

## How to use

1. Paste JSON into **Input JSON**, or select **Load example**.
2. Choose an indentation style.
3. Select **Format** or **Minify**. The result appears in **Output**.
4. Select **Validate** to check the input without producing output.
5. Use **Copy** or **Download** to take the result with you, and **Clear** to start over.

If the input is invalid, the status area explains what went wrong and, when possible, where.

## Privacy

Your JSON is processed locally in your browser with native JavaScript APIs. The application does not send input to a server, does not store it in local storage or cookies, and includes no analytics or tracking scripts. User input is never executed (`eval()` is not used) and is rendered with text nodes rather than HTML injection.

## Deploy to GitHub Pages

1. Create a new GitHub repository (for example, `json-formatter-validator`) and push this project to the `main` branch.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Select the `main` branch and the `/ (root)` folder, then save.
5. After a minute or two, the site is available at `https://YOUR-USERNAME.github.io/json-formatter-validator/`.

All asset paths are relative, so the site works under a repository sub-path.

Before publishing, replace the placeholder GitHub link in `index.html` (search for `YOUR-USERNAME`) with your repository URL.

## Known limitations

- The tool relies on `JSON.parse()` and `JSON.stringify()`, so it follows JavaScript semantics: integers beyond `Number.MAX_SAFE_INTEGER` lose precision, `-0` becomes `0`, and when an object repeats a key only the last value is kept.
- Error messages differ between browsers. When a browser does not report a position, no line or column is shown rather than guessing one.
- Very large documents (tens of megabytes) depend on the browser's memory. Syntax highlighting is disabled for output over 300,000 characters.
- Comments, trailing commas, and single-quoted strings are rejected because they are not valid JSON.

## License

No license has been selected yet. Add a `LICENSE` file and update this section when you choose one.
