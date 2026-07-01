import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP_BASE = path.join(ROOT, '.tmp');
const NPM_CLI = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

function run(command, args, cwd, env = {}) {
	const executable = command === 'npm' ? process.execPath : command;
	const finalArgs = command === 'npm' ? [NPM_CLI, ...args] : args;
	const result = spawnSync(executable, finalArgs, {
		cwd,
		stdio: 'pipe',
		encoding: 'utf8',
		shell: false,
		env: { ...process.env, ...env },
	});

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
		throw new Error(`${command} ${args.join(' ')} failed in ${cwd}\n${details}`);
	}

	return result.stdout.trim();
}

function packPackage(packageDir, destinationDir, env) {
	const output = run('npm', ['pack', '--pack-destination', destinationDir], packageDir, env);
	const tarballName = output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1);
	if (!tarballName) {
		throw new Error(`npm pack did not report a tarball name for ${packageDir}`);
	}
	return path.join(destinationDir, tarballName);
}

function copyWorkspacePackage(sourceSegments, destinationSegments) {
	const candidates = [path.join(ROOT, 'node_modules', ...sourceSegments), path.join(ROOT, 'packages', 'react', 'node_modules', ...sourceSegments)];
	const source = candidates.find((candidate) => existsSync(candidate));
	if (!source) {
		throw new Error(`Unable to locate workspace package ${sourceSegments.join('/')}`);
	}
	const destination = path.join(...destinationSegments);
	mkdirSync(path.dirname(destination), { recursive: true });
	cpSync(source, destination, { recursive: true, dereference: true });
}

function main() {
	mkdirSync(TMP_BASE, { recursive: true });
	const tmpRoot = mkdtempSync(path.join(TMP_BASE, 'open-grid-pack-verify-'));
	const tarballDir = path.join(tmpRoot, 'tarballs');
	const fixtureTemplateDir = path.join(ROOT, 'fixtures', 'package-consumer');
	const fixtureDir = path.join(tmpRoot, 'package-consumer');
	const npmCacheDir = path.join(tmpRoot, 'npm-cache');
	const npmEnv = { npm_config_cache: npmCacheDir };

	mkdirSync(tarballDir, { recursive: true });
	mkdirSync(npmCacheDir, { recursive: true });

	try {
		const coreTarball = packPackage(path.join(ROOT, 'packages', 'core'), tarballDir, npmEnv);
		const reactTarball = packPackage(path.join(ROOT, 'packages', 'react'), tarballDir, npmEnv);

		cpSync(fixtureTemplateDir, fixtureDir, { recursive: true });

		const packageJsonPath = path.join(fixtureDir, 'package.json');
		const packageJson = readFileSync(packageJsonPath, 'utf8')
			.replace('__CORE_TARBALL__', coreTarball.replace(/\\/g, '/'))
			.replace('__REACT_TARBALL__', reactTarball.replace(/\\/g, '/'));
		writeFileSync(packageJsonPath, packageJson);

		run('npm', ['install', '--no-save', '--ignore-scripts', '--legacy-peer-deps', coreTarball, reactTarball], fixtureDir, npmEnv);
		copyWorkspacePackage(['react'], [fixtureDir, 'node_modules', 'react']);
		copyWorkspacePackage(['react-dom'], [fixtureDir, 'node_modules', 'react-dom']);
		copyWorkspacePackage(['@types', 'react'], [fixtureDir, 'node_modules', '@types', 'react']);
		copyWorkspacePackage(['@types', 'react-dom'], [fixtureDir, 'node_modules', '@types', 'react-dom']);
		run(
			process.execPath,
			[path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', path.join(fixtureDir, 'tsconfig.json')],
			ROOT
		);

		process.stdout.write(`pack:verify succeeded using fixture ${fixtureDir}\n`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.stderr.write(`pack:verify workspace preserved at ${tmpRoot}\n`);
		process.exitCode = 1;
		return;
	}

	rmSync(tmpRoot, { recursive: true, force: true });
}

main();
