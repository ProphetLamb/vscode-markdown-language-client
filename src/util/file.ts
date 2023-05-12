/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as URI from 'vscode-uri';
import { Schemes } from './schemes';

export const markdownFileExtensions = Object.freeze<string[]>([
	'md',
	'mkd',
	'mdwn',
	'mdown',
	'markdown',
	'markdn',
	'mdtxt',
	'mdtext',
	'workbook',
]);

export function isMarkdownFile(document: vscode.TextDocument) {
	return document.languageId === 'markdown';
}

export function looksLikeMarkdownPath(resolvedHrefPath: vscode.Uri): boolean {
	const doc = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === resolvedHrefPath.toString());
	if (doc) {
		return isMarkdownFile(doc);
	}

	if (resolvedHrefPath.scheme === Schemes.notebookCell) {
		for (const notebook of vscode.workspace.notebookDocuments) {
			for (const cell of notebook.getCells()) {
				if (cell.kind === vscode.NotebookCellKind.Markup && isMarkdownFile(cell.document)) {
					return true;
				}
			}
		}
		return false;
	}

	return markdownFileExtensions.includes(URI.Utils.extname(resolvedHrefPath).toLowerCase().replace('.', ''));
}


declare global {
	interface String {
		lineCount(): number;
	}
}

String.prototype.lineCount = function () {
  let count = 1;

  let chr;
  let i = 0, end = this.length;
  for (; i < end; ++i) {
    if (this[i] == '\n' || this[i] == '\r') {
      count = 2;
      chr = this[i];
      break;
    }
  }
  for (++i; i < end; ++i) {
    if (this[i] == chr) {
      ++count;
    }
  }
  return count;
}
