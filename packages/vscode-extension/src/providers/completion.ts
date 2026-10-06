/**
 * Completion Provider - Provides autocomplete for Teloce templates
 */

import * as vscode from 'vscode';
import { getCompletionItems, type CompletionItem } from '@teloce/language-service';
import { isComponentDocument } from '../documents.js';

export class TeloceCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[]> {
    // Never offer template completions in page shells (Flask/Django .html),
    // and honour the `teloce.completion.enable` setting.
    if (!isComponentDocument(document)) return [];
    const enabled = vscode.workspace.getConfiguration('teloce.completion').get<boolean>('enable', true);
    if (enabled === false) return [];

    const content = document.getText();
    const offset = document.offsetAt(position);

    try {
      const items = getCompletionItems({
        content,
        position: offset,
        line: position.line,
        column: position.character,
        word: this.getWordAtPosition(document, position),
        ast: [],
      });

      return items.map(item => this.convertCompletionItem(item));
    } catch (error) {
      console.error('Completion error:', error);
      return [];
    }
  }

  private getWordAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): string {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return '';
    return document.getText(wordRange);
  }

  private convertCompletionItem(item: CompletionItem): vscode.CompletionItem {
    const kind = this.convertKind(item.kind);
    const result = new vscode.CompletionItem(item.label, kind);
    
    result.detail = item.detail;
    result.documentation = new vscode.MarkdownString(item.documentation);
    result.sortText = item.sortText;
    
    if (item.insertText) {
      result.insertText = new vscode.SnippetString(item.insertText);
    }

    // Add command if needed
    if (item.command) {
      result.command = {
        command: item.command.command,
        arguments: item.command.arguments || [],
        title: '',
      };
    }

    return result;
  }

  private convertKind(kind: string): vscode.CompletionItemKind {
    const map: Record<string, vscode.CompletionItemKind> = {
      keyword: vscode.CompletionItemKind.Keyword,
      directive: vscode.CompletionItemKind.Interface,
      attribute: vscode.CompletionItemKind.Property,
      event: vscode.CompletionItemKind.Event,
      binding: vscode.CompletionItemKind.Variable,
      component: vscode.CompletionItemKind.Class,
      variable: vscode.CompletionItemKind.Variable,
      function: vscode.CompletionItemKind.Function,
      snippet: vscode.CompletionItemKind.Snippet,
      text: vscode.CompletionItemKind.Text,
    };
    return map[kind] || vscode.CompletionItemKind.Text;
  }
}