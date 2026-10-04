/**
 * Hover Provider - Provides hover information for Teloce templates
 */

import * as vscode from 'vscode';
import { getHoverInfo, type HoverInfo } from '@teloce/language-service';
import { isComponentDocument } from '../documents.js';

export class TeloceHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    if (!isComponentDocument(document)) return null;
    const content = document.getText();

    try {
      const info = getHoverInfo(content, position.line, position.character);
      if (!info) return null;

      const range = info.range
        ? new vscode.Range(
            new vscode.Position(info.range.start.line, info.range.start.character),
            new vscode.Position(info.range.end.line, info.range.end.character)
          )
        : new vscode.Range(position, position);

      const markdown = new vscode.MarkdownString();
      markdown.appendMarkdown(info.content);

      if (info.example) {
        markdown.appendMarkdown('\n\n**Example:**\n```html\n' + info.example + '\n```');
      }

      if (info.links && info.links.length > 0) {
        markdown.appendMarkdown('\n\n**Documentation:**\n');
        for (const link of info.links) {
          markdown.appendMarkdown(`[${link}](${link})\n`);
        }
      }

      return new vscode.Hover(markdown, range);
    } catch (error) {
      console.error('Hover error:', error);
      return null;
    }
  }
}