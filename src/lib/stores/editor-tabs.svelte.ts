import { browser } from '$app/environment';

const STORAGE_KEY = 'crowtools-tabs';

const DEFAULT_SOURCE = `#include <stdio.h>
#include <stdlib.h>

struct Point {
    int x;
    int y;
};

int main() {
    int count = 3;
    struct Point origin = {0, 0};

    int *scores = calloc(count, sizeof(int));
    scores[0] = 100;
    scores[1] = 200;
    scores[2] = 300;

    for (int i = 0; i < count; i++) {
        scores[i] = scores[i] * 2;
    }

    free(scores);
    return 0;
}`;

export interface EditorTab {
	name: string;
	source: string;
}

interface StoredData {
	tabs: EditorTab[];
	active: number;
}

function load(): StoredData {
	if (!browser) return defaults();
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return defaults();
		const data = JSON.parse(raw);
		if (!Array.isArray(data.tabs) || data.tabs.length === 0) return defaults();
		const tabs = data.tabs.filter(
			(t: unknown): t is EditorTab =>
				typeof t === 'object' && t !== null &&
				typeof (t as Record<string, unknown>).name === 'string' &&
				typeof (t as Record<string, unknown>).source === 'string'
		);
		if (tabs.length === 0) return defaults();
		const active = typeof data.active === 'number'
			? Math.min(Math.max(0, data.active), tabs.length - 1)
			: 0;
		return { tabs, active };
	} catch {
		return defaults();
	}
}

function defaults(): StoredData {
	return { tabs: [{ name: 'Program 1', source: DEFAULT_SOURCE }], active: 0 };
}

function save(data: StoredData): void {
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	} catch {
		// Quota exceeded or other error — code still works in session
	}
}

export function createEditorTabStore(initial?: StoredData) {
	const data = initial ?? load();
	let tabs = $state<EditorTab[]>(data.tabs);
	let active = $state(data.active);

	function nextName(): string {
		const used = new Set(
			tabs.map((t) => {
				const m = t.name.match(/^Program (\d+)$/);
				return m ? parseInt(m[1], 10) : 0;
			})
		);
		let n = 1;
		while (used.has(n)) n++;
		return `Program ${n}`;
	}

	function addTab(): void {
		tabs.push({ name: nextName(), source: '' });
		active = tabs.length - 1;
	}

	function removeTab(index: number): void {
		if (tabs.length <= 1) return;
		tabs.splice(index, 1);
		if (active >= tabs.length) {
			active = tabs.length - 1;
		} else if (active > index) {
			active = active - 1;
		}
	}

	function updateSource(index: number, source: string): void {
		if (index >= 0 && index < tabs.length) {
			tabs[index].source = source;
		}
	}

	function setActive(index: number): void {
		if (index >= 0 && index < tabs.length) {
			active = index;
		}
	}

	return {
		get tabs() { return tabs; },
		get active() { return active; },
		get activeTab() { return tabs[active]; },
		addTab,
		removeTab,
		updateSource,
		setActive,
	};
}

export type EditorTabStore = ReturnType<typeof createEditorTabStore>;

/**
 * Start debounced localStorage persistence.
 * Call this from a component (needs reactive owner for $effect).
 */
export function initPersistence(store: EditorTabStore): void {
	$effect(() => {
		const snapshot = { tabs: $state.snapshot(store.tabs), active: store.active };
		const t = setTimeout(() => save(snapshot), 500);
		return () => clearTimeout(t);
	});

	// Safety net: save immediately on page unload
	if (browser) {
		const handler = () => {
			save({ tabs: $state.snapshot(store.tabs), active: store.active });
		};
		window.addEventListener('beforeunload', handler);
		// No cleanup needed — lives for page lifetime
	}
}
