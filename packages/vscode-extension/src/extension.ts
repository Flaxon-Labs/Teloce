/**
 * Teloce VS Code Extension
 * 
 * This extension provides language support for Teloce templates
 * using the @teloce/language-service package.
 */

import * as vscode from 'vscode';
import {
  TeloceCompletionProvider,
  TeloceDiagnosticProvider,
  TeloceHoverProvider,
  TeloceFormattingProvider,
  TeloceSymbolProvider,
  TeloceTypeScriptFeatures,
} from './providers/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { registerCommands } from './commands/index.js';
/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('🐛 Teloce extension activated');

  // .vel files, plus .html files. Providers only act on .html files that are
  // actually Teloce components (see documents.ts); page shells are ignored.
  const selector: vscode.DocumentSelector = [
    { language: 'teloce' },
    { language: 'html', scheme: 'file' },
  ];

  // Template completion, hover and outline
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new TeloceCompletionProvider(),
      '@', ':', '|', ' ', '{'
    ),
    vscode.languages.registerHoverProvider(selector, new TeloceHoverProvider()),
    vscode.languages.registerDocumentSymbolProvider(selector, new TeloceSymbolProvider())
  );

  // Format-on-save/format-document for .vel files. Not registered for .html:
  // VS Code would then ask every HTML user to pick a default formatter. For
  // component-style .html files use the "Teloce: Format" command instead.
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(
      { language: 'teloce' },
      new TeloceFormattingProvider()
    )
  );

  // TypeScript type-checking, hover, completion and go-to-definition for
  // <script lang="ts"> in .vel files and component-style .html files.
  // The lib.*.d.ts files are copied next to the bundle at build time.
  const bundledLibDir = path.join(context.extensionPath, 'dist', 'ts-lib');
  const typeScriptFeatures = new TeloceTypeScriptFeatures({
    libDir: fs.existsSync(bundledLibDir) ? bundledLibDir : undefined,
  });
  typeScriptFeatures.register();
  context.subscriptions.push(typeScriptFeatures);

  // Template diagnostics (own collection, listeners and per-document timers)
  const diagnosticProvider = new TeloceDiagnosticProvider();
  diagnosticProvider.startMonitoring();
  context.subscriptions.push(diagnosticProvider);

  // Commands. "Validate" runs both checkers on demand.
  registerCommands(context, undefined, async (document) => {
    const template = await diagnosticProvider.provideDiagnostics(
      document,
      new vscode.CancellationTokenSource().token,
      true
    );
    const typescript = await typeScriptFeatures.publishDiagnostics(document);
    return { template: template.length, typescript };
  });

  // Show welcome message for first time
  const isFirstTime = context.globalState.get('teloce.firstTime', true);
  if (isFirstTime) {
    vscode.window.showInformationMessage(
      '🐛 Teloce extension activated! Create a .vel file to get started.'
    );
    context.globalState.update('teloce.firstTime', false);
  }
}

/**
 * Extension deactivation
 */
export function deactivate() {
  console.log('🐛 Teloce extension deactivated');
}