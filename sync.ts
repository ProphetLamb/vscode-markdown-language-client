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
		// remove line: import { activateShared } from './extension.shared';
		{ regex: /import { .* } from '\.\/extension\.shared';\n/g, replace: "" },
		// remove line: import { VsCodeOutputLogger } from './logging';
		{ regex: /import { .* } from '\.\/logging';\n/g, replace: "" },
		// remove line: import { getMarkdownExtensionContributions } from './markdownExtensions';
		{ regex: /import { .* } from '\.\/markdownExtensions';\n/g, replace: "" },
		// remove line: import { githubSlugifier } from './slugify';
		{ regex: /import { .* } from '\.\/slugify';\n/g, replace: "" },
		// replace:	import { IMdParser, MarkdownItEngine } from './markdownEngine';
		// with:		import { IMdParser } from './markdownEngine';
		{ regex: /import { IMdParser, MarkdownItEngine } from '\.\/markdownEngine';\n/g, replace: "import { IMdParser } from './markdownEngine';" },
		// replace: function startServer(
		// with:		export function startServer(
		{ regex: /function startServer\(/g, replace: "export function startServer(" },
		// remove function: export async function activate(context: vscode.ExtensionContext) { ... }
		{ regex: /export async function activate\(context: vscode\.ExtensionContext\)\s*/gm, replace: "", removeBodyAfterMatch: true },
	]),
	"src/logging.ts": new TransformDescriptor("extensions/markdown-language-features/src/logging.ts"),
	"src/markdownEngine.ts" : new TransformDescriptor("extensions/markdown-language-features/src/markdownEngine.ts", [
		// replace: await import('markdown-it')
		// with: 		(await import('markdown-it')).default
		{ regex: /await import\('markdown-it'\)/g, replace: "(await import('markdown-it')).default" },
	]),
	"src/markdownExtensions.ts": new TransformDescriptor("extensions/markdown-language-features/src/markdownExtensions.ts"),
	"src/slugify.ts": new TransformDescriptor("extensions/markdown-language-features/src/slugify.ts"),
	"src/client/fileWatchingManager.ts": new TransformDescriptor("extensions/markdown-language-features/src/client/fileWatchingManager.ts"),
	"src/client/inMemoryDocument.ts" : new TransformDescriptor("extensions/markdown-language-features/src/client/inMemoryDocument.ts"),
	"src/client/protocol.ts" : new TransformDescriptor("extensions/markdown-language-features/src/client/protocol.ts"),
	"src/client/workspace.ts" : new TransformDescriptor("extensions/markdown-language-features/src/client/workspace.ts"),
	"src/types/textDocument.ts" : new TransformDescriptor("extensions/markdown-language-features/src/types/textDocument.ts"),
	"src/typings/ref.d.ts": new TransformDescriptor("extensions/markdown-language-features/src/typings/ref.d.ts"),
	"src/util/arrays.ts" : new TransformDescriptor("extensions/markdown-language-features/src/util/arrays.ts"),
	"src/util/dispose.ts" : new TransformDescriptor("extensions/markdown-language-features/src/util/dispose.ts"),
	"src/util/file.ts" : new TransformDescriptor("extensions/markdown-language-features/src/util/file.ts"),
	"src/util/resourceMap.ts" : new TransformDescriptor("extensions/markdown-language-features/src/util/resourceMap.ts"),
	"src/util/resources.ts" : new TransformDescriptor("extensions/markdown-language-features/src/util/resources.ts"),
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

	if (pathOrUrl instanceof URL) {
		if (pathOrUrl.protocol === "file:") {
			// assume relative url
			return fs.promises.readFile(`.${pathOrUrl.pathname}`);
		}
		return downloadFile(pathOrUrl);
	}

	return fs.promises.readFile(pathOrUrl);
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

async function updateFile(localFile: fs.PathLike, transform: TransformDescriptor, bar: ProgressBar): Promise<void> {
	try {
		const buffer = await readFile(new URL(transform.remotePath, baseUrl));
		bar.tick();
		const patched = await applyTransform(buffer, transform);
		bar.tick();
		const parent = path.dirname(localFile.toString());
		await fs.promises.mkdir(parent, { recursive: true });
		await fs.promises.writeFile(localFile, patched);
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
