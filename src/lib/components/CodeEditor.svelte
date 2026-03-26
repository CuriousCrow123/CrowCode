<script lang="ts">
	import type { SourceLocation } from '$lib/types';
	import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
	import { EditorState, StateField, StateEffect } from '@codemirror/state';
	import { basicSetup } from 'codemirror';
	import { cpp } from '@codemirror/lang-cpp';
	import { oneDark } from '@codemirror/theme-one-dark';

	let { source, location }: { source: string; location: SourceLocation } = $props();

	let container: HTMLDivElement;

	// NOT $state — plain variable to avoid reactive cycles
	let view: EditorView | undefined;

	const setHighlight = StateEffect.define<SourceLocation>();

	const lineDeco = Decoration.line({ class: 'cm-active-step-line' });

	const highlightField = StateField.define<DecorationSet>({
		create() {
			return Decoration.none;
		},
		update(decos, tr) {
			for (const effect of tr.effects) {
				if (effect.is(setHighlight)) {
					const loc = effect.value;
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

	// Create editor once container is available
	$effect(() => {
		if (!container) return;

		view = new EditorView({
			state: EditorState.create({
				doc: source,
				extensions: [
					basicSetup,
					cpp(),
					oneDark,
					crowTheme,
					EditorState.readOnly.of(true),
					highlightField,
				],
			}),
			parent: container,
		});

		view.dispatch({
			effects: setHighlight.of(location),
		});

		return () => {
			view?.destroy();
			view = undefined;
		};
	});

	// Update highlight when location changes
	$effect(() => {
		if (!view) return;
		const loc = location;

		view.dispatch({
			effects: setHighlight.of(loc),
		});

		const doc = view.state.doc;
		if (loc.line >= 1 && loc.line <= doc.lines) {
			const lineObj = doc.line(loc.line);
			view.dispatch({
				effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
			});
		}
	});
</script>

<div bind:this={container} class="h-full overflow-hidden rounded-lg border border-zinc-800"></div>
