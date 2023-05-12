/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Range, Position } from 'vscode-languageserver-types';
import * as mdls from 'vscode-markdown-languageservice';
import { URI } from 'vscode-uri';

/**
 * Minimal version of {@link vscode.TextDocument}.
 */
export interface ITextDocument {
	readonly uri: vscode.Uri;
	readonly version: number;

	getText(): string;
}

export class MdLsTextDocumentProxy implements mdls.ITextDocument  {
	constructor(private readonly document: ITextDocument) { this.getLines(); }
	private lines: string[] | undefined;
	uri: string = this.document.uri.toString();
	$uri?: URI | undefined = this.document.uri;
	version: number = this.document.version;
	lineCount: number = 0;
	getLines() {
		if (!this.lines) {
			this.lines = this.document.getText().split(/\r\n|\r|\n/);
			this.lineCount = this.lines.length;
		}
		return this.lines;
	}
	getText(range?: Range | undefined): string {
		if (!range) {
			return this.document.getText();
		}
		return this.document.getText().slice(this.offsetAt(range.start), this.offsetAt(range.end));
	}
	positionAt(offset: number): Position {
		const lines = this.getLines();
		let lineStart = 0;
		for (let i = 0; i < lines.length; i++) {
			const lineLength = lines[i].length + 1;
			if (lineStart + lineLength > offset) {
				return {
					line: i,
					character: offset - lineStart
				};
			}
			lineStart += lineLength;
		}
		return {
			line: lines.length - 1,
			character: lines[lines.length - 1].length
		};
	}
	offsetAt(position: Position): number {
		const lines = this.getLines();
		if (position.line >= lines.length) {
			return this.document.getText().length;
		}
		if (position.line < 0) {
			return 0;
		}
		let offset = 0;
		for (let i = 0; i < position.line; i++) {
			offset += lines[i].length + 1;
		}
		return Math.min(offset + position.character, this.document.getText().length);
	}
}
