// Pull remote files over local files
// Apply patches to remote files
// Attempt to compile the patched files

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import ProgressBar from 'progress';

class Patch {
	constructor(public readonly remotePath: string, public readonly patches?: { regex: RegExp, replace: string, removeBodyAfterMatch?: boolean }[] | undefined) { }
}

const baseUrl = "https://raw.githubusercontent.com/microsoft/vscode/main/"
const fileMappings: { [key: string]: Patch } = {
	"tsconfig.base.json" : new Patch("extensions/tsconfig.base.json"),
	"src/launcher.ts" : new Patch("extensions/markdown-language-features/src/extension.ts", [
		// replace: import { IMdParser, MarkdownItEngine } from './markdownEngine';
		// with: 		import { IMdParser } from 'vscode-markdown-languageservice';
		{ regex: /import { IMdParser, MarkdownItEngine } from '\.\/markdownEngine';/g, replace: "import { IMdParser } from 'vscode-markdown-languageservice';" },
		// remove line: import { activateShared } from './extension.shared';
		{ regex: /import { activateShared } from '\.\/extension\.shared';\n/g, replace: "" },
		// remove line: import { VsCodeOutputLogger } from './logging';
		{ regex: /import { VsCodeOutputLogger } from '\.\/logging';\n/g, replace: "" },
		// remove line: import { getMarkdownExtensionContributions } from './markdownExtensions';
		{ regex: /import { getMarkdownExtensionContributions } from '\.\/markdownExtensions';\n/g, replace: "" },
		// remove line: import { githubSlugifier } from './slugify';
		{ regex: /import { githubSlugifier } from '\.\/slugify';\n/g, replace: "" },
		// replace: function startServer(context: vscode.ExtensionContext, parser: IMdParser): Promise<MdLanguageClient> {
		// with:		export function startServer(context: vscode.ExtensionContext, parser: IMdParser): Promise<MdLanguageClient> {
		{ regex: /function startServer\(context: vscode\.ExtensionContext, parser: IMdParser\): Promise<MdLanguageClient> {/g, replace: "export function startServer(context: vscode.ExtensionContext, parser: IMdParser): Promise<MdLanguageClient> {" },
		// remove function: export async function activate(context: vscode.ExtensionContext) { ... }
		{ regex: /export async function activate\(context: vscode\.ExtensionContext\)\s*/gm, replace: "", removeBodyAfterMatch: true },
	]),
	"src/client/client.ts" : new Patch("extensions/markdown-language-features/src/client/client.ts"),
	"src/client/fileWatchingManager.ts": new Patch("extensions/markdown-language-features/src/client/fileWatchingManager.ts"),
	"src/client//inMemoryDocument.ts" : new Patch("extensions/markdown-language-features/src/client/inMemoryDocument.ts"),
	"src/client/protocol.ts" : new Patch("extensions/markdown-language-features/src/client/protocol.ts"),
	"src/client/workspace.ts" : new Patch("extensions/markdown-language-features/src/client/workspace.ts"),
	"src/types/textDocument.ts" : new Patch("extensions/markdown-language-features/src/types/textDocument.ts"),
	"src/util/dispose.ts" : new Patch("extensions/markdown-language-features/src/util/dispose.ts"),
	"src/util/file.ts" : new Patch("extensions/markdown-language-features/src/util/file.ts"),
	"src/util/resourceMap.ts" : new Patch("extensions/markdown-language-features/src/util/resourceMap.ts"),
	"src/util/schemes.ts" : new Patch("extensions/markdown-language-features/src/util/schemes.ts")
}

function downloadFile(url: string): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const req = https.get(url, (res) => {
			let data: Buffer[] = [];
			res.on('data', (chunk) => {
				data.push(chunk);
			});
			res.on('end', () => {
				resolve(Buffer.concat(data));
			});
		});
		req.on('error', (err) => {
			reject(err);
		});
	});
}

function applyPatches(file: Buffer, patches: { regex: RegExp, replace: string, removeBodyAfterMatch?: boolean }[]): string {
	function matchNestedBrackets(str: string, start: number): number {
		let depth = 0;
		for (let i = start; i < str.length; i++) {
			if (str[i] === '{') {
				depth++;
			} else if (str[i] === '}') {
				depth--;
				if (depth === 0) {
					return i;
				}
			}
		}
		return -1;
	}
	function removeMatchAndNestedBrackets(result: string, match: RegExpExecArray): string {
		const start = match.index + match.length;
		const end = matchNestedBrackets(result, start);
		if (end === -1) {
			throw new Error("Could not find matching bracket");
		}
		return result.substring(0, match.index) + result.substring(end + 1);
	}

	let result = file.toString();
	for (const patch of patches) {
		if (!patch.removeBodyAfterMatch) {
			result = result.replace(patch.regex, patch.replace);
		} else {
			// after each match, find bracket pairs and remove them
			// also remove the match itself
			let match: RegExpExecArray | null;
			while (match = patch.regex.exec(result)) {
				result = removeMatchAndNestedBrackets(result, match);
			}
		}
	}
	return result;
}

function writeFile(path: fs.PathLike, data: string): Promise<void> {
	return new Promise((resolve, reject) => {
		fs.writeFile(path, data, (err) => {
			if (err) {
				reject(err);
			}
			resolve();
		});
	});
}

async function updateFile(localFile: fs.PathLike, patch: Patch, bar: ProgressBar): Promise<void> {
	try {
		const buffer = await downloadFile(baseUrl + patch.remotePath);
		bar.tick();
		const patched = applyPatches(buffer, patch.patches ?? []);
		bar.tick();
		await writeFile(localFile, patched);
		bar.tick();
	} catch (err) {
		bar.interrupt(`Failed to update ${localFile}`);
		console.error(err);
	}
}

const maxFileNameLength: number = function(){
	let max = 0;
	for (const file in fileMappings) {
		max = Math.max(max, file.length);
	}
	return max;
}();

function mainBar(file: string): ProgressBar {
	const padding = maxFileNameLength - file.length;
	const pad = ' '.repeat(padding);
	const title = `Updating ${file}${pad} [:bar] :percent`;
	return new ProgressBar(title, {
		complete: '=',
		incomplete: ' ',
		width: 50,
		total: 3
	});
}

export async function main() {
	let operations: Promise<void>[] = [];
	let bars: ProgressBar[] = [];
	for (const localFile in fileMappings) {
		let bar = mainBar(localFile);
		bars.push(bar);

		const patch = fileMappings[localFile];
		const localPath = path.join(__dirname, localFile);
		operations.push(updateFile(localPath, patch, bar));
	}
	await Promise.all(operations);
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
