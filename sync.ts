// Pull remote files over local files
// Apply patches to remote files
// Attempt to compile the patched files
// required progress and @types/progress

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import ProgressBar from 'progress';

class Patch {
	constructor(public readonly remotePath: string, public readonly patches?: { regex: RegExp, replace: string }[] | undefined) { }
}

const baseUrl = "https://raw.githubusercontent.com/microsoft/vscode/main/"
const fileMappings: { [key: string]: Patch } = {
	"tsconfig.base.json" : new Patch("extensions/tsconfig.base.json"),
	"src/launcher.ts" : new Patch("extensions/markdown-language-features/src/extension.ts"),
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

function applyPatches(file: Buffer, patches: { regex: RegExp, replace: string }[]): string {
	let result = file.toString();
	for (const patch of patches) {
		result = result.replace(patch.regex, patch.replace);
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
