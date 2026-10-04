/**
 * Commands - VS Code commands for Teloce
 */

import * as vscode from 'vscode';
import { formatTemplate } from '@teloce/language-service';
import { DebuggerManager, isPortOpen, isTeloceDashboard } from '../debugger/manager.js';
import { isComponentDocument } from '../documents.js';

/** Validates a document; returns how many problems each checker found. */
export type ValidateDocument = (
  document: vscode.TextDocument
) => Promise<{ template: number; typescript: number }>;

/** The tag that makes a page report its errors to the debugger dashboard. */
export function debuggerScriptTag(host: string, port: number): string {
  return `<script src="http://${host}:${port}/client.js"></script>`;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  debuggerManager: DebuggerManager = new DebuggerManager(),
  validateDocument?: ValidateDocument
) {
  // Stops the embedded debugger server when the extension is deactivated.
  context.subscriptions.push(debuggerManager);

  // Format command
  context.subscriptions.push(
    vscode.commands.registerCommand('teloce.format', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const document = editor.document;
      if (!isComponentDocument(document)) {
        vscode.window.showInformationMessage(
          'Teloce: open a .vel file, or a component-style .html file, to format it.'
        );
        return;
      }
      const content = document.getText();
      const config = vscode.workspace.getConfiguration('teloce.format');
      
      const formatted = formatTemplate(content, {
        indentSize: config.get('indentSize', 2),
        useTabs: config.get('useTabs', false),
        indentHTML: true,
        maxLineLength: 80,
        preserveNewlines: true,
      });

      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(content.length)
      );

      await editor.edit(builder => {
        builder.replace(fullRange, formatted);
      });
    })
  );

  // Validate command: checks the template and any <script lang="ts"> now,
  // reports the result, and opens the Problems panel if there is something to fix.
  context.subscriptions.push(
    vscode.commands.registerCommand('teloce.validate', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Teloce: open a .vel or component-style .html file to validate it.');
        return;
      }
      const document = editor.document;
      if (!isComponentDocument(document)) {
        vscode.window.showInformationMessage(
          'Teloce: this file is not a Teloce component (.vel, or .html with a <template> or <script lang="ts">).'
        );
        return;
      }
      if (!validateDocument) return;

      const { template, typescript } = await validateDocument(document);
      const total = template + typescript;
      if (total === 0) {
        vscode.window.showInformationMessage('Teloce: no problems found.');
        return;
      }

      const parts = [
        template ? `${template} in the template` : '',
        typescript ? `${typescript} in TypeScript` : '',
      ].filter(Boolean);
      vscode.window.showWarningMessage(
        `Teloce: ${total} problem${total === 1 ? '' : 's'} found (${parts.join(', ')}).`
      );
      await vscode.commands.executeCommand('workbench.actions.view.problems');
    })
  );

  // Open debugger: runs the dashboard inside the extension, then opens it.
  context.subscriptions.push(
    vscode.commands.registerCommand('teloce.openDebugger', async () => {
      const config = vscode.workspace.getConfiguration('teloce.debugger');
      const host = config.get('host', 'localhost');
      const port = config.get('port', 9000);
      const url = `http://${host}:${port}`;

      if (await isPortOpen(host, port)) {
        // Either our own server, or `teloce debug` started from a terminal.
        // Anything else on that port is not the debugger, so say so.
        if (debuggerManager.running || (await isTeloceDashboard(url))) {
          vscode.env.openExternal(vscode.Uri.parse(url));
          void offerScriptTag(host, port);
        } else {
          vscode.window.showErrorMessage(
            `Port ${port} is in use by another program. Change "teloce.debugger.port" in settings.`
          );
        }
        return;
      }

      try {
        await debuggerManager.start(host, port);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Could not start the Teloce debugger on ${url}: ${reason}`);
        return;
      }
      vscode.env.openExternal(vscode.Uri.parse(url));
      void offerScriptTag(host, port);
    })
  );

  // Copy the script tag a page needs to report errors to the debugger
  context.subscriptions.push(
    vscode.commands.registerCommand('teloce.copyDebuggerScript', async () => {
      const config = vscode.workspace.getConfiguration('teloce.debugger');
      const tag = debuggerScriptTag(config.get('host', 'localhost'), config.get('port', 9000));
      await vscode.env.clipboard.writeText(tag);
      vscode.window.showInformationMessage(`Copied: ${tag}  Paste it into your page (.html or .vel shell).`);
    })
  );

  // Stop debugger
  context.subscriptions.push(
    vscode.commands.registerCommand('teloce.stopDebugger', async () => {
      const stopped = await debuggerManager.stop();
      vscode.window.showInformationMessage(
        stopped
          ? 'Teloce debugger stopped.'
          : 'No debugger started by this extension is running. (If you started one with `teloce debug`, stop it in its terminal.)'
      );
    })
  );
}

/**
 * The dashboard shows what pages report to it, so after opening it, offer the
 * one-line script tag that connects a page. Works in any HTML file.
 */
async function offerScriptTag(host: string, port: number): Promise<void> {
  const copy = 'Copy script tag';
  const choice = await vscode.window.showInformationMessage(
    'Teloce debugger is open. Add its script tag to a page to see that page\'s errors.',
    copy
  );
  if (choice === copy) {
    await vscode.env.clipboard.writeText(debuggerScriptTag(host, port));
  }
}
