<script lang="ts">
	import type { Program } from '$lib/types';
	import { createEditorTabStore, initPersistence } from '$lib/stores/editor-tabs.svelte';
	import { testPrograms, getCategories } from '$lib/test-programs';
	import EditorTabs from '$lib/components/EditorTabs.svelte';
	import CodeEditor from '$lib/components/CodeEditor.svelte';
	import MemoryView from '$lib/components/MemoryView.svelte';
	import StepControls from '$lib/components/StepControls.svelte';
	import { buildSnapshots, getVisibleIndices, nearestVisibleIndex } from '$lib/engine';

	const store = createEditorTabStore();
	initPersistence(store);

	const categories = getCategories();

	// Mode state machine
	type AppMode =
		| { state: 'editing' }
		| { state: 'running' }
		| { state: 'viewing'; program: Program; errors: string[]; warnings: string[] };

	let mode = $state<AppMode>({ state: 'editing' });
	let errors = $state<string[]>([]);
	let warnings = $state<string[]>([]);

	// Per-tab run result cache
	interface CachedRun {
		program: Program;
		errors: string[];
		warnings: string[];
		stepIndex: number;
		subStepMode: boolean;
	}
	const runCache = new Map<number, CachedRun>();

	// Abort guard for stale runs
	let runGeneration = 0;

	async function run() {
		const thisRun = ++runGeneration;
		mode = { state: 'running' };
		errors = [];
		warnings = [];

		try {
			const { runProgram } = await import('$lib/interpreter/service');
			if (thisRun !== runGeneration) return;

			const result = await runProgram(store.activeTab.source);
			if (thisRun !== runGeneration) return;

			errors = result.errors;
			warnings = result.warnings;

			if (result.program.steps.length > 0) {
				const program = JSON.parse(JSON.stringify(result.program));
				mode = {
					state: 'viewing',
					program,
					errors: result.errors,
					warnings: result.warnings,
				};
				// Cache the result for this tab
				runCache.set(store.active, {
					program,
					errors: result.errors,
					warnings: result.warnings,
					stepIndex: 0,
					subStepMode: false,
				});
			} else {
				if (errors.length === 0) {
					errors = ['No steps generated — check your code.'];
				}
				mode = { state: 'editing' };
			}
		} catch (err) {
			if (thisRun !== runGeneration) return;
			errors = [err instanceof Error ? err.message : String(err)];
			mode = { state: 'editing' };
		}
	}

	function edit() {
		// Save step position before leaving viewing mode
		if (mode.state === 'viewing') {
			const cached = runCache.get(store.active);
			if (cached) {
				cached.stepIndex = internalIndex;
				cached.subStepMode = subStepMode;
			}
		}
		mode = { state: 'editing' };
	}

	function handleTabSelect(index: number) {
		// Save step position of current tab before switching
		if (mode.state === 'viewing') {
			const cached = runCache.get(store.active);
			if (cached) {
				cached.stepIndex = internalIndex;
				cached.subStepMode = subStepMode;
			}
		}

		store.setActive(index);
		runGeneration++; // abort any in-flight run

		// Restore cached run for the new tab
		const cached = runCache.get(index);
		if (cached) {
			mode = {
				state: 'viewing',
				program: cached.program,
				errors: cached.errors,
				warnings: cached.warnings,
			};
			errors = cached.errors;
			warnings = cached.warnings;
			internalIndex = cached.stepIndex;
			subStepMode = cached.subStepMode;
		} else {
			mode = { state: 'editing' };
			errors = [];
			warnings = [];
		}
	}

	function handleSourceChange(source: string) {
		store.updateSource(store.active, source);
		// Invalidate cache — source changed since last run
		runCache.delete(store.active);
	}

	function loadTestProgram(event: Event) {
		const select = event.target as HTMLSelectElement;
		const id = select.value;
		if (!id) return;
		const prog = testPrograms.find((p) => p.id === id);
		if (prog) {
			store.updateSource(store.active, prog.source);
			runCache.delete(store.active);
			mode = { state: 'editing' };
			errors = [];
			warnings = [];
		}
		select.value = '';
	}

	// Stepping state (only used in viewing mode)
	let internalIndex = $state(0);
	let subStepMode = $state(false);

	const viewingProgram = $derived(mode.state === 'viewing' ? mode.program : null);
	// $state.snapshot() strips Svelte proxies so structuredClone inside buildSnapshots works
	const snapshots = $derived(viewingProgram ? buildSnapshots($state.snapshot(viewingProgram) as Program) : []);
	const steps = $derived(viewingProgram?.steps ?? []);
	const visibleIndices = $derived(getVisibleIndices(steps, subStepMode));

	const visiblePosition = $derived.by(() => {
		const direct = visibleIndices.indexOf(internalIndex);
		if (direct !== -1) return direct;
		const nearest = nearestVisibleIndex(visibleIndices, internalIndex);
		return visibleIndices.indexOf(nearest);
	});

	const currentStep = $derived(steps[internalIndex]);
	const currentSnapshot = $derived(snapshots[internalIndex] ?? []);

	const editorLocation = $derived.by(() => {
		if (mode.state !== 'viewing') return undefined;
		const loc = currentStep?.location ?? { line: 1 };
		if (subStepMode) return loc;
		return { line: loc.line };
	});

	function prev() {
		const pos = visiblePosition;
		if (pos > 0) internalIndex = visibleIndices[pos - 1];
	}

	function next() {
		const pos = visiblePosition;
		if (pos < visibleIndices.length - 1) internalIndex = visibleIndices[pos + 1];
	}

	function toggleSubStep() {
		subStepMode = !subStepMode;
		const newVisible = getVisibleIndices(steps, subStepMode);
		internalIndex = nearestVisibleIndex(newVisible, internalIndex);
	}

	// Keyboard shortcuts (only in viewing mode)
	function handleKeydown(e: KeyboardEvent) {
		if (mode.state !== 'viewing') return;
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		if (e.target instanceof HTMLElement && e.target.closest('.cm-editor')) return;
		switch (e.key) {
			case 'ArrowLeft':
				e.preventDefault();
				prev();
				break;
			case 'ArrowRight':
				e.preventDefault();
				next();
				break;
			case 's':
			case 'S':
				e.preventDefault();
				toggleSubStep();
				break;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<main class="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center px-4 py-6">
	<h1 class="text-2xl font-bold mb-1">CrowTools</h1>
	<p class="text-zinc-500 text-sm mb-4">Memory Visualizer</p>

	<!-- Toolbar: tabs + examples + run/edit -->
	<div class="w-full max-w-7xl flex items-center gap-3 mb-4 flex-wrap">
		<EditorTabs
			tabs={store.tabs}
			active={store.active}
			onselect={handleTabSelect}
			onadd={() => { store.addTab(); runCache.clear(); mode = { state: 'editing' }; errors = []; warnings = []; }}
			onclose={(i) => { store.removeTab(i); runCache.clear(); mode = { state: 'editing' }; errors = []; warnings = []; }}
		/>

		<div class="flex items-center gap-2 ml-auto">
			<select
				onchange={loadTestProgram}
				aria-label="Load example program"
				class="bg-zinc-800 text-zinc-300 text-sm font-mono px-3 py-1.5 rounded border border-zinc-700 focus:border-blue-500/50 focus:outline-none cursor-pointer"
			>
				<option value="">Examples...</option>
				{#each categories as cat}
					<optgroup label={cat}>
						{#each testPrograms.filter((p) => p.category === cat) as prog}
							<option value={prog.id}>{prog.name}</option>
						{/each}
					</optgroup>
				{/each}
			</select>

			{#if mode.state === 'viewing'}
				<button
					onclick={edit}
					class="px-4 py-1.5 rounded text-sm font-mono bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors"
				>
					Edit
				</button>
			{:else}
				<button
					onclick={run}
					disabled={mode.state === 'running'}
					class="px-4 py-1.5 rounded text-sm font-mono bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{mode.state === 'running' ? 'Running...' : 'Run'}
				</button>
			{/if}
		</div>
	</div>

	<!-- Errors / Warnings -->
	{#if errors.length > 0}
		<div class="w-full max-w-7xl mb-3 bg-red-500/10 border border-red-500/30 rounded p-3" role="alert">
			{#each errors as error}
				<p class="text-red-400 text-sm font-mono">{error}</p>
			{/each}
		</div>
	{/if}
	{#if warnings.length > 0}
		<div class="w-full max-w-7xl mb-3 bg-amber-500/10 border border-amber-500/30 rounded p-3">
			{#each warnings as warning}
				<p class="text-amber-400 text-sm font-mono">{warning}</p>
			{/each}
		</div>
	{/if}

	<!-- Main area: editor + memory view -->
	<div class="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-4">
		<!-- Code Editor + Step Controls -->
		<div class="flex flex-col">
			<div class="h-[70vh]">
				<CodeEditor
					source={store.activeTab.source}
					location={editorLocation}
					readOnly={mode.state === 'viewing'}
					onchange={mode.state === 'editing' ? handleSourceChange : undefined}
				/>
			</div>

			{#if mode.state === 'viewing'}
				<div class="mt-3">
					<StepControls
						current={visiblePosition}
						total={visibleIndices.length}
						{subStepMode}
						description={currentStep?.description}
						evaluation={currentStep?.evaluation}
						onprev={prev}
						onnext={next}
						ontogglesubstep={toggleSubStep}
					/>
				</div>
			{/if}
		</div>

		<!-- Memory View -->
		<div class="max-h-[70vh] overflow-y-auto">
			{#if mode.state === 'viewing'}
				<MemoryView data={currentSnapshot} />
			{:else}
				<div class="h-full flex items-center justify-center text-zinc-600 text-sm font-mono">
					Click Run to visualize memory
				</div>
			{/if}
		</div>
	</div>
</main>
