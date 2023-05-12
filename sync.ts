// Pull remote files over local files
// Apply patches to remote files
// Attempt to compile the patched files

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import ProgressBar from 'progress';

interface Patch {
	regex: RegExp,
	replace: fs.PathLike,
	removeBodyAfterMatch?: boolean
}

class TransformDescriptor {
	constructor(public readonly remotePath: string, public readonly patches?: Patch[] | undefined, public readonly append?: fs.PathLike[]) { }
}

const baseUrl = "https://raw.githubusercontent.com/microsoft/vscode/main/"
const transformers: { [key: string]: TransformDescriptor } = {
	"tsconfig.base.json" : new TransformDescriptor("extensions/tsconfig.base.json"),
	"src/launcher.ts" : new TransformDescriptor("extensions/markdown-language-features/src/extension.ts", [
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
	"src/client/client.ts" : new TransformDescriptor("extensions/markdown-language-features/src/client/client.ts", [
		// replace: import { IMdParser } from '../markdownEngine';
		// with: 		import { IMdParser } from 'vscode-markdown-languageservice';
		//					import { MdLsTextDocumentProxy } from '../types/textDocument';
		{ regex: /import { IMdParser } from '\.\.\/markdownEngine';/g, replace: new URL("sync/client_imports", "file://") },
		// replace:	return parser.tokenize(doc);
		// with:		return parser.tokenize(new MdLsTextDocumentProxy(doc));
		{ regex: /return parser\.tokenize\(doc\);/g, replace: "return parser.tokenize(new MdLsTextDocumentProxy(doc));" },
	]),
	"src/client/fileWatchingManager.ts": new TransformDescriptor("extensions/markdown-language-features/src/client/fileWatchingManager.ts"),
	"src/client//inMemoryDocument.ts" : new TransformDescriptor("extensions/markdown-language-features/src/client/inMemoryDocument.ts"),
	"src/client/protocol.ts" : new TransformDescriptor("extensions/markdown-language-features/src/client/protocol.ts"),
	"src/client/workspace.ts" : new TransformDescriptor("extensions/markdown-language-features/src/client/workspace.ts"),
	"src/types/textDocument.ts" : new TransformDescriptor("extensions/markdown-language-features/src/types/textDocument.ts", [
		// replace: import * as vscode from 'vscode';
		// with:		file://./sync/textDocument_imports
		{ regex: /import \* as vscode from 'vscode';/g, replace: new URL("sync/textDocument_imports", "file://") },
	], [
		// append: export class MdLsTextDocumentProxy implements vscode.TextDocument {
		new URL("sync/textDocument_MdLsTextDocumentProxy", "file://"),
	]),
	"src/util/dispose.ts" : new TransformDescriptor("extensions/markdown-language-features/src/util/dispose.ts"),
	"src/util/file.ts" : new TransformDescriptor("extensions/markdown-language-features/src/util/file.ts"),
	"src/util/resourceMap.ts" : new TransformDescriptor("extensions/markdown-language-features/src/util/resourceMap.ts"),
	"src/util/schemes.ts" : new TransformDescriptor("extensions/markdown-language-features/src/util/schemes.ts")
}

function readFile(pathOrUrl: fs.PathLike): Promise<Buffer> {
	function downloadFile(url: string | URL): Promise<Buffer> {
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

	function readFileSystem(path: fs.PathLike): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			fs.readFile(path, (err, data) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(data);
			});
		});
	}

	if (pathOrUrl instanceof URL) {
		if (pathOrUrl.protocol === "file:") {
			// assume relative url
			return readFileSystem(`.${pathOrUrl.pathname}`);
		}
		return downloadFile(pathOrUrl);
	}

	return readFileSystem(pathOrUrl);
}

async function applyTransform(file: Buffer, transform: TransformDescriptor): Promise<string> {
	function resolveTransformReplacement(pathOrUrl: fs.PathLike): Promise<string> {
		async function resolvePathLikeCoreAsync(pathOrUrl: fs.PathLike): Promise<string> {
			const buf = await readFile(pathOrUrl);
			return buf.toString();
		}

		if (typeof pathOrUrl === 'string') {
			return Promise.resolve(pathOrUrl);
		}
		if (pathOrUrl instanceof Buffer) {
			return Promise.resolve(pathOrUrl.toString());
		}

		return resolvePathLikeCoreAsync(pathOrUrl);
	}

	function removeMatchAndSubsequentNestedBrackets(result: string, match: RegExpExecArray): string {
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

		const start = match.index + match.length;
		const end = matchNestedBrackets(result, start);
		if (end === -1) {
			throw new Error("Could not find matching bracket");
		}
		return result.substring(0, match.index) + result.substring(end + 1);
	}

	async function applyPatch(patch: Patch, result: string): Promise<string> {
		if (!patch.removeBodyAfterMatch) {
			result = result.replace(patch.regex, await resolveTransformReplacement(patch.replace));
		} else {
			// after each match, find bracket pairs and remove them
			// also remove the match itself
			let match: RegExpExecArray | null;
			while (match = patch.regex.exec(result)) {
				result = removeMatchAndSubsequentNestedBrackets(result, match);
			}
		}
		return result;
	}

	let result = file.toString();
	for (const patch of transform.patches ?? []) {
		result = await applyPatch(patch, result);
	}

	for(const append of transform.append ?? []) {
		result += await resolveTransformReplacement(append);
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

async function updateFile(localFile: fs.PathLike, transform: TransformDescriptor, bar: ProgressBar): Promise<void> {
	try {
		const buffer = await readFile(new URL(transform.remotePath, baseUrl));
		bar.tick();
		const patched = await applyTransform(buffer, transform);
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
	for (const file in transformers) {
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
	for (const localFile in transformers) {
		let bar = mainBar(localFile);
		bars.push(bar);

		const patch = transformers[localFile];
		const localPath = path.join(__dirname, localFile);
		operations.push(updateFile(localPath, patch, bar));
	}
	await Promise.all(operations);
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
