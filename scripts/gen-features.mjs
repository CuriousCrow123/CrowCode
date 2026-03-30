#!/usr/bin/env node
/**
 * Generates src/lib/data/features.ts from docs/feature-inventory.md
 * and src/lib/data/features-compiled.ts from docs/feature-inventory-compiled.md.
 *
 * Run: node scripts/gen-features.mjs
 * Wired as prebuild/predev in package.json.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Helpers ──

/** Strip backticks and leading/trailing pipes from a markdown table cell. */
function clean(cell) {
	return cell.replace(/`/g, '').replace(/\\\|/g, '|').trim();
}

/** Parse a markdown table row into cells. Handles escaped pipes \| */
function parseRow(line) {
	// Split on | but not \|
	const raw = line.split(/(?<!\\)\|/).slice(1, -1);
	return raw.map(clean);
}

/** Is this a table separator line (|---|---|) */
function isSeparator(line) {
	return /^\|[\s:?-]+\|/.test(line);
}

/** Is this a table header row? (immediately followed by a separator) */
function isHeader(line, nextLine) {
	return line.startsWith('|') && nextLine && isSeparator(nextLine);
}

/** Is this a data row? (starts with | but not a separator or header) */
function isRow(line) {
	return line.startsWith('|') && !isSeparator(line);
}

function escapeStr(s) {
	return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ── Feature extraction ──

// Sections we skip for feature extraction (they're metadata, not features)
const SKIP_SECTIONS = new Set([
	'Architecture Constraints', 'Test Programs', 'Test Coverage', 'Summary',
	'Prioritized Remaining Work',
]);

/** @typedef {{ name: string; category: string; status: string; description: string }} Feature */

/**
 * Parse a feature-inventory markdown file and return a Feature array.
 * @param {string} inputPath
 * @returns {Feature[]}
 */
function parseFeatureInventory(inputPath) {
	const md = readFileSync(inputPath, 'utf-8');
	const lines = md.split('\n');

	/** @type {Feature[]} */
	const features = [];

	/** Track which lines are headers so we can skip them */
	const headerLines = new Set();
	for (let i = 0; i < lines.length - 1; i++) {
		if (isHeader(lines[i], lines[i + 1])) {
			headerLines.add(i);
		}
	}

	function add(name, category, status, description) {
		if (!name) return;
		features.push({ name, category, status, description: description || '' });
	}

	let h2 = '';
	let h3 = '';

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Track headings
		if (line.startsWith('## ') && !line.startsWith('### ')) {
			h2 = line.slice(3).trim();
			h3 = '';
			continue;
		}
		if (line.startsWith('### ')) {
			h3 = line.slice(4).trim();
			continue;
		}

		// Skip non-feature sections
		if (SKIP_SECTIONS.has(h2)) continue;
		if (h2 === 'Prioritized Remaining Work') continue;

		// Only process data rows (skip headers and separators)
		if (!isRow(line) || headerLines.has(i)) continue;

		const cells = parseRow(line);
		if (cells.length < 2) continue;

		// ── Standard Library: Not Implemented / Not Available ──
		// Format: | Category | `fn1`, `fn2`, ... |
		if (h2 === 'Standard Library' && (h3 === 'Not Implemented' || h3 === 'Not Available')) {
			const category = cells[0];
			const funcs = cells[1].split(',').map((f) => f.trim()).filter(Boolean);
			for (const fn of funcs) {
				add(fn, 'Standard Library', 'not-implemented', `${category} function. Not implemented.`);
			}
			continue;
		}

		// ── Standard Library: Available via xcc libc (not instrumented) ──
		// Format: | Category | `fn1`, `fn2`, ... |
		if (h2 === 'Standard Library' && h3.startsWith('Available via')) {
			const category = cells[0];
			const funcs = cells[1].split(',').map((f) => f.trim()).filter(Boolean);
			for (const fn of funcs) {
				add(fn, 'Standard Library', 'partial', `${category} function. Available via xcc libc but not instrumented for visualization.`);
			}
			continue;
		}

		// ── Standard Library: Implemented ──
		// Format: | Function | Notes |
		if (h2 === 'Standard Library' && (h3.startsWith('Implemented'))) {
			add(cells[0], 'Standard Library', 'implemented', cells[1] || '');
			continue;
		}

		// ── Partially Working ──
		// Format: | Feature | What works | What doesn't | Notes |
		if (h2 === 'Partially Working') {
			const desc = [cells[1], cells[2], cells[3]].filter(Boolean).join('. ');
			add(cells[0], 'Partial', 'partial', desc);
			continue;
		}

		// ── Advantages Over / Limitations Compared ──
		// Format: | Feature | Compiled | Interpreter | Notes |
		if (h2.startsWith('Advantages Over') || h2.startsWith('Limitations Compared')) {
			// Skip comparison tables — they're informational, not feature declarations
			continue;
		}

		// ── Not Implemented: Language Features ──
		// Format: | Feature | Parser/Compiler | Interpreter/Instrumented | Difficulty | Notes |
		if (h2 === 'Not Implemented' && h3 === 'Language Features') {
			const lastCol = cells[cells.length - 1];
			add(cells[0], 'Language', 'not-implemented', lastCol || '');
			continue;
		}

		// ── Not Implemented: Visualization Gaps ──
		// Format: | Gap | Notes |
		if (h2 === 'Not Implemented' && h3 === 'Visualization Gaps') {
			add(cells[0], 'Visualization', 'not-implemented', cells[1] || '');
			continue;
		}

		// ── Not Implemented: Format String Gaps ──
		// Format: | Gap | Difficulty | Notes |
		if (h2 === 'Not Implemented' && h3 === 'Format String Gaps') {
			add(cells[0], 'Format Strings', 'not-implemented', cells[2] || '');
			continue;
		}

		// ── Not Implemented: Runtime Limitations ──
		// Format: | Limitation | Notes |
		if (h2 === 'Not Implemented' && h3 === 'Runtime Limitations') {
			add(cells[0], 'Runtime', 'not-implemented', cells[1] || '');
			continue;
		}

		// ── Sections with "Tested" column (Data Types, Operators, Control Flow, Functions, Memory) ──
		if (['Data Types', 'Operators', 'Control Flow', 'Functions', 'Memory Management'].includes(h2)) {
			const testedIdx = cells.findIndex((c) => /^(Yes|Partial|Implicit|No)$/i.test(c));
			const name = cells[0];
			const tested = testedIdx >= 0 ? cells[testedIdx] : '';

			let status = 'implemented';
			if (/^partial$/i.test(tested)) status = 'partial';
			else if (/^no$/i.test(tested)) status = 'not-implemented';

			const category = h2 === 'Memory Management' ? 'Memory' : h2;

			const lastCol = cells[cells.length - 1];
			let desc = '';
			if (testedIdx === cells.length - 1) {
				desc = cells.slice(1, testedIdx).filter(Boolean).join('. ');
			} else {
				desc = lastCol || '';
			}
			add(name, category, status, desc);
			continue;
		}

		// ── Visualization ──
		// Format: | Feature | Status | Notes |
		if (h2 === 'Visualization') {
			const status = /working/i.test(cells[1]) ? 'implemented' : 'not-implemented';
			add(cells[0], 'Visualization', status, cells[2] || '');
			continue;
		}

		// ── UI Features, Engine, Infrastructure ──
		// Format: | Feature | Notes | — all implemented
		if (['UI Features', 'Engine', 'Infrastructure'].includes(h2)) {
			add(cells[0], h2, 'implemented', cells[1] || '');
			continue;
		}
	}

	return features;
}

// ── Generate TypeScript ──

/**
 * Write a features TypeScript file.
 * @param {Feature[]} features
 * @param {string} outputPath
 * @param {string} sourceDoc - name of the source markdown file
 * @param {string} exportName - name of the exported array
 */
function writeFeatureFile(features, outputPath, sourceDoc, exportName) {
	const tsLines = [
		`// AUTO-GENERATED from ${sourceDoc}`,
		'// Do not edit manually — run: node scripts/gen-features.mjs',
		'',
		"import type { Feature } from './features';",
		'',
		`export const ${exportName}: Feature[] = [`,
	];

	for (const f of features) {
		tsLines.push(`\t{ name: '${escapeStr(f.name)}', category: '${escapeStr(f.category)}', status: '${f.status}', description: '${escapeStr(f.description)}' },`);
	}

	tsLines.push('];', '');

	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, tsLines.join('\n'), 'utf-8');
}

// ── Main ──

// 1. Interpreter features (existing)
const interpreterInput = resolve(ROOT, 'docs/feature-inventory.md');
const interpreterOutput = resolve(ROOT, 'src/lib/data/features.ts');
const interpreterFeatures = parseFeatureInventory(interpreterInput);

// Write interpreter features with the type definition (primary file)
const interpreterLines = [
	'// AUTO-GENERATED from docs/feature-inventory.md',
	'// Do not edit manually — run: node scripts/gen-features.mjs',
	'',
	"export type FeatureStatus = 'implemented' | 'partial' | 'not-implemented';",
	'',
	'export interface Feature {',
	'\tname: string;',
	'\tcategory: string;',
	'\tstatus: FeatureStatus;',
	'\tdescription: string;',
	'}',
	'',
	'export const features: Feature[] = [',
];
for (const f of interpreterFeatures) {
	interpreterLines.push(`\t{ name: '${escapeStr(f.name)}', category: '${escapeStr(f.category)}', status: '${f.status}', description: '${escapeStr(f.description)}' },`);
}
interpreterLines.push('];', '');
mkdirSync(dirname(interpreterOutput), { recursive: true });
writeFileSync(interpreterOutput, interpreterLines.join('\n'), 'utf-8');
console.log(`gen-features: wrote ${interpreterFeatures.length} features to src/lib/data/features.ts`);

// 2. Compiled features (new)
const compiledInput = resolve(ROOT, 'docs/feature-inventory-compiled.md');
const compiledOutput = resolve(ROOT, 'src/lib/data/features-compiled.ts');
const compiledFeatures = parseFeatureInventory(compiledInput);

writeFeatureFile(compiledFeatures, compiledOutput, 'docs/feature-inventory-compiled.md', 'compiledFeatures');
console.log(`gen-features: wrote ${compiledFeatures.length} features to src/lib/data/features-compiled.ts`);
