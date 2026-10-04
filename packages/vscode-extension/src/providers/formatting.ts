/**
 * Formatting Provider - Formats Teloce templates
 */

import * as vscode from 'vscode';
import { formatTemplate } from '@teloce/language-service';
import { isComponentDocument } from '../documents.js';

export class TeloceFormattingProvider implements vscode.DocumentFormattingEditProvider {
  async provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.TextEdit[]> {
    if (!isComponentDocument(document)) return [];
    try {
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

      return [vscode.TextEdit.replace(fullRange, formatted)];
    } catch (error) {
      console.error('Formatting error:', error);
      return [];
    }
  }
}