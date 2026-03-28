<script lang="ts">
	import type { SourceLocation } from '$lib/types';
	import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
	import { EditorState, StateField, StateEffect, Compartment } from '@codemirror/state';
	import { untrack } from 'svelte';
	import { basicSetup } from 'codemirror';
	import { cpp } from '@codemirror/lang-cpp';
	import { oneDark } from '@codemirror/theme-one-dark';

	let {
		source,
		location,
		readOnly = true,
		onchange,
	}: {
		source: string;
		location?: SourceLocation;
		readOnly?: boolean;
		onchange?: (source: string) => void;
	} = $props();

	let container: HTMLDivElement;

	// NOT $state — plain variable to avoid reactive cycles
	let view: EditorView | undefined;
	let editorReady = $state(false);

	const readOnlyCompartment = new Compartment();
	const setHighlight = StateEffect.define<SourceLocation | null>();

	const lineDeco = Decoration.line({ class: 'cm-active-step-line' });

	const highlightField = StateField.define<DecorationSet>({
		create() {
			return Decoration.none;
		},
		update(decos, tr) {
			for (const effect of tr.effects) {
				if (effect.is(setHighlight)) {
					const loc = effect.value;
					if (!loc) return Decoration.none;
					const doc = tr.state.doc;
					if (loc.line < 1 || loc.line > doc.lines) return Decoration.none;

					const lineObj = doc.line(loc.line);

					if (loc.colStart !== undefined && loc.colEnd !== undefined) {
						const from = lineObj.from + loc.colStart;
						const to = Math.min(lineObj.from + loc.colEnd, lineObj.to);
						const rangeDeco = Decoration.mark({ class: 'cm-active-step-range' });
						return Decoration.set([
							lineDeco.range(lineObj.from),
							rangeDeco.range(from, to),
						]);
					}

					return Decoration.set([lineDeco.range(lineObj.from)]);
				}
			}
			return decos;
		},
		provide: (f) => EditorView.decorations.from(f),
	});

	const crowTheme = EditorView.theme({
		'&': {
			backgroundColor: 'rgb(9, 9, 11)',
			height: '100%',
		},
		'.cm-gutters': {
			backgroundColor: 'rgb(24, 24, 27)',
			borderRight: '1px solid rgb(39, 39, 42)',
			color: 'rgb(113, 113, 122)',
		},
		'.cm-activeLineGutter': {
			backgroundColor: 'transparent',
		},
		'.cm-active-step-line': {
			backgroundColor: 'rgba(59, 130, 246, 0.12)',
			borderLeft: '3px solid rgb(59, 130, 246)',
			paddingLeft: '0',
		},
		'.cm-active-step-range': {
			backgroundColor: 'rgba(59, 130, 246, 0.25)',
			borderBottom: '2px solid rgb(59, 130, 246)',
		},
	});

	const staticExtensions = [
		basicSetup,
		cpp(),
		oneDark,
		crowTheme,
		highlightField,
	];

	// Create editor once container is available.
	// Uses untrack so this only re-runs when container changes (mount/unmount).
	$effect(() => {
		if (!container) return;

		const initialSource = untrack(() => source);
		const initialReadOnly = untrack(() => readOnly);

		view = new EditorView({
			state: EditorState.create({
				doc: initialSource,
				extensions: [
					...staticExtensions,
					readOnlyCompartment.of(EditorState.readOnly.of(initialReadOnly)),
					EditorView.updateListener.of((update) => {
						if (update.docChanged && onchange) {
							onchange(update.state.doc.toString());
						}
					}),
				],
			}),
			parent: container,
		});
		editorReady = true;

		return () => {
			view?.destroy();
			view = undefined;
			editorReady = false;
		};
	});

	// Toggle readOnly when prop changes
	$effect(() => {
		if (!editorReady || !view) return;
		const ro = readOnly;
		view.dispatch({
			effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(ro)),
		});
	});

	// Sync document when source changes externally (tab switch)
	$effect(() => {
		if (!editorReady || !view) return;
		const src = source;
		const currentDoc = view.state.doc.toString();
		if (currentDoc === src) return; // no-op guard to prevent infinite loop
		// Replace document content without recreating the view
		view.dispatch({
			changes: { from: 0, to: currentDoc.length, insert: src },
		});
	});

	// Update highlight when location changes
	$effect(() => {
		if (!editorReady || !view) return;
		const loc = location ?? null;

		view.dispatch({
			effects: setHighlight.of(loc),
		});

		if (loc && loc.line >= 1 && loc.line <= view.state.doc.lines) {
			const lineObj = view.state.doc.line(loc.line);
			view.dispatch({
				effects: EditorView.scrollIntoView(lineObj.from, { y: 'nearest' }),
			});
		}
	});
</script>

<div bind:this={container} class="h-full overflow-hidden rounded-lg border border-zinc-800"></div>
