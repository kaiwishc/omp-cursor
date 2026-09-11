import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export function ensurePrivateArtifactDirectory(path) {
	mkdirSync(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
	if (process.platform !== "win32") chmodSync(path, PRIVATE_DIRECTORY_MODE);
}

export function writePrivateArtifact(path, content) {
	writeFileSync(path, content, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
	if (process.platform !== "win32") chmodSync(path, PRIVATE_FILE_MODE);
}

export function copyPrivateArtifact(source, destination) {
	copyFileSync(source, destination);
	if (process.platform !== "win32") chmodSync(destination, PRIVATE_FILE_MODE);
}
