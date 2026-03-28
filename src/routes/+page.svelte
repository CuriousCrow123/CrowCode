<script lang="ts">
	import type { Program } from '$lib/types';
	import type { InteractiveSession } from '$lib/interpreter/service';
	import { createEditorTabStore, initPersistence } from '$lib/stores/editor-tabs.svelte';
	import { testPrograms, getCategories } from '$lib/test-programs';
	import EditorTabs from '$lib/components/EditorTabs.svelte';
	import CodeEditor from '$lib/components/CodeEditor.svelte';
	import MemoryView from '$lib/components/MemoryView.svelte';
	import StepControls from '$lib/components/StepControls.svelte';
	import ConsolePanel, { type ConsoleSegment } from '$lib/components/ConsolePanel.svelte';
	import StdinInput from '$lib/components/StdinInput.svelte';
	import { buildSnapshots, buildConsoleOutputs, getVisibleIndices, nearestVisibleIndex } from '$lib/engine';

	const store = createEditorTabStore();
	initPersistence(store);

	const categories = getCategories();

	// I/O mode: pre-supplied or interactive
	type IoMode = 'presupplied' | 'interactive';
	let ioMode = $state<IoMode>('presupplied');

	// Mode state machine
	type AppMode =
		| { state: 'editing' }
		| { state: 'running' }
		| { state: 'viewing'; program: Program; errors: string[]; warnings: string[] }
		| { state: 'waiting_for_input'; program: Program; errors: string[]; warnings: string[]; resume: (input: string) => Promise<InteractiveSession>; cancel: () => void };

	let mode = $state<AppMode>({ state: 'editing' });
	let errors = $state<string[]>([]);
	let warnings = $state<string[]>([]);

	// Interactive mode: history of user-submitted stdin with the step index they were entered at
	let interactiveStdinEntries = $state<{ text: string; afterStep: number }[]>([]);

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
		interactiveStdinEntries = [];

		try {
			if (ioMode === 'interactive') {
				await runInteractive(thisRun);
			} else {
				await runPreSupplied(thisRun);
			}
		} catch (err) {
			if (thisRun !== runGeneration) return;
			errors = [err instanceof Error ? err.message : String(err)];
			mode = { state: 'editing' };
		}
	}

	async function runPreSupplied(thisRun: number) {
		const { runProgram } = await import('$lib/interpreter/service');
		if (thisRun !== runGeneration) return;

		const result = await runProgram(store.activeTab.source, stdinInput || undefined);
		if (thisRun !== runGeneration) return;

		errors = result.errors;
		warnings = result.warnings;

		if (result.program.steps.length > 0) {
			const program = JSON.parse(JSON.stringify(result.program));
			internalIndex = 0;
			subStepMode = false;
			mode = {
				state: 'viewing',
				program,
				errors: result.errors,
				warnings: result.warnings,
			};
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
	}

	async function runInteractive(thisRun: number) {
		const { runProgramInteractive } = await import('$lib/interpreter/service');
		if (thisRun !== runGeneration) return;

		const session = await runProgramInteractive(store.activeTab.source);
		if (thisRun !== runGeneration) return;

		handleInteractiveSession(session, thisRun);
	}

	function handleInteractiveSession(session: InteractiveSession, generation: number, preserveIndex = false) {
		if (generation !== runGeneration) return;

		if (session.state === 'complete') {
			const result = session.result;
			errors = result.errors;
			warnings = result.warnings;

			if (result.program.steps.length > 0) {
				const program = JSON.parse(JSON.stringify(result.program));
				if (!preserveIndex) {
					internalIndex = 0;
					subStepMode = false;
				}
				mode = {
					state: 'viewing',
					program,
					errors: result.errors,
					warnings: result.warnings,
				};
				runCache.set(store.active, {
					program,
					errors: result.errors,
					warnings: result.warnings,
					stepIndex: internalIndex,
					subStepMode,
				});
			} else {
				if (errors.length === 0) {
					errors = ['No steps generated — check your code.'];
				}
				mode = { state: 'editing' };
			}
			return;
		}

		// Paused — needs input
		errors = session.errors;
		warnings = session.warnings;

		const program = JSON.parse(JSON.stringify(session.program));
		if (!preserveIndex) {
			internalIndex = 0;
			subStepMode = false;
		}

		// Create generation-guarded resume
		const sessionResume = session.resume;
		const sessionCancel = session.cancel;

		mode = {
			state: 'waiting_for_input',
			program,
			errors: session.errors,
			warnings: session.warnings,
			resume: async (input: string) => {
				if (generation !== runGeneration) throw new Error('Stale session');
				return sessionResume(input);
			},
			cancel: () => sessionCancel(),
		};
	}

	function handleSubmitInput(text: string) {
		if (mode.state !== 'waiting_for_input') return;
		const resumeFn = mode.resume;
		const gen = runGeneration;

		// Record stdin entry with the step it was provided at (for interleaved display)
		interactiveStdinEntries = [...interactiveStdinEntries, { text, afterStep: steps.length - 1 }];

		// Flip state SYNCHRONOUSLY before async work (prevents double-submit)
		mode = { state: 'running' };

		resumeFn(text).then((session) => {
			// Preserve step index — don't reset on resume
			handleInteractiveSession(session, gen, true);
		}).catch((err) => {
			if (gen !== runGeneration) return;
			errors = [err instanceof Error ? err.message : String(err)];
			mode = { state: 'editing' };
		});
	}

	function handleEof() {
		if (mode.state !== 'waiting_for_input') return;
		// Send empty string — the service will signal EOF
		// Actually, we need to signal EOF through the resume path
		// For now, send empty string which the IoState treats as no new input
		handleSubmitInput('');
	}

	function stopInteractive() {
		if (mode.state === 'waiting_for_input') {
			mode.cancel();
		}
		mode = { state: 'editing' };
	}


	function edit() {
		// Cancel interactive session if paused
		if (mode.state === 'waiting_for_input') {
			mode.cancel();
		}
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
		// Cancel interactive session if paused
		if (mode.state === 'waiting_for_input') {
			mode.cancel();
		}
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
			stdinInput = prog.stdin ?? '';
			runCache.delete(store.active);
			mode = { state: 'editing' };
			errors = [];
			warnings = [];
		}
		select.value = '';
	}

	// stdin state (per-tab)
	let stdinInput = $state('');
	const needsStdin = $derived(/\b(scanf|getchar|fgets|gets)\s*\(/.test(store.activeTab.source));

	// Stepping state (only used in viewing mode)
	let internalIndex = $state(0);
	let subStepMode = $state(false);

	const viewingProgram = $derived(
		mode.state === 'viewing' ? mode.program :
		mode.state === 'waiting_for_input' ? mode.program :
		null
	);
	// $state.snapshot() strips Svelte proxies so structuredClone inside buildSnapshots works
	const snapshots = $derived(viewingProgram ? buildSnapshots($state.snapshot(viewingProgram) as Program) : []);
	const steps = $derived(viewingProgram?.steps ?? []);
	const consoleOutputs = $derived(viewingProgram ? buildConsoleOutputs(viewingProgram.steps) : []);
	const visibleIndices = $derived(getVisibleIndices(steps, subStepMode));

	const visiblePosition = $derived.by(() => {
		const direct = visibleIndices.indexOf(internalIndex);
		if (direct !== -1) return direct;
		const nearest = nearestVisibleIndex(visibleIndices, internalIndex);
		return visibleIndices.indexOf(nearest);
	});

	const currentStep = $derived(steps[internalIndex]);
	const currentSnapshot = $derived(snapshots[internalIndex] ?? []);
	const currentConsoleOutput = $derived(consoleOutputs[internalIndex] ?? '');
	const previousConsoleOutput = $derived(internalIndex > 0 ? (consoleOutputs[internalIndex - 1] ?? '') : '');
	const newConsoleOutput = $derived(
		currentConsoleOutput.length > previousConsoleOutput.length
			? currentConsoleOutput.slice(previousConsoleOutput.length)
			: ''
	);
	const hasConsoleOutput = $derived(consoleOutputs.some((o) => o.length > 0));

	/**
	 * Build interleaved console segments for interactive mode.
	 * Walks steps up to internalIndex, emitting stdout segments and inserting
	 * stdin echoes at the step where the user provided input.
	 */
	const interactiveSegments = $derived.by((): ConsoleSegment[] => {
		if (ioMode !== 'interactive') return [];
		const segs: ConsoleSegment[] = [];
		let stdinIdx = 0;
		for (let i = 0; i <= internalIndex && i < steps.length; i++) {
			const step = steps[i];
			if (step?.ioEvents) {
				for (const e of step.ioEvents) {
					if (e.kind === 'write' && e.target === 'stdout') {
						segs.push({ type: 'stdout', text: e.text });
					}
				}
			}
			// Insert stdin echo after the step where user provided input
			while (stdinIdx < interactiveStdinEntries.length && interactiveStdinEntries[stdinIdx].afterStep === i) {
				segs.push({ type: 'stdin', text: interactiveStdinEntries[stdinIdx].text });
				stdinIdx++;
			}
		}
		return segs;
	});

	/** For pre-supplied mode: simple segments from stdout string. */
	const preSuppliedSegments = $derived.by((): ConsoleSegment[] => {
		if (currentConsoleOutput.length === 0) return [];
		if (newConsoleOutput.length > 0) {
			return [
				{ type: 'stdout', text: previousConsoleOutput },
				{ type: 'stdout', text: newConsoleOutput },
			];
		}
		return [{ type: 'stdout', text: currentConsoleOutput }];
	});

	// stdin consumption tracking
	const stdinConsumed = $derived.by(() => {
		if (mode.state !== 'viewing' && mode.state !== 'waiting_for_input') return 0;
		const step = steps[internalIndex];
		if (!step?.ioEvents) return 0;
		// Find the last stdin-read event up to current step
		let pos = 0;
		for (let i = 0; i <= internalIndex; i++) {
			const events = steps[i]?.ioEvents;
			if (events) {
				for (const e of events) {
					if (e.kind === 'read') pos = e.cursorPos;
				}
			}
		}
		return pos;
	});

	const editorLocation = $derived.by(() => {
		if (mode.state !== 'viewing' && mode.state !== 'waiting_for_input') return undefined;
		const loc = currentStep?.location ?? { line: 1 };
		if (subStepMode) return loc;
		return { line: loc.line };
	});

	// Collect descriptions from all steps between previous visible and current (inclusive).
	// In sub-step mode, just the current step. In line mode, includes skipped sub-steps.
	const stepDescriptions = $derived.by(() => {
		if (mode.state !== 'viewing' && mode.state !== 'waiting_for_input') return [];
		if (subStepMode) {
			const step = steps[internalIndex];
			if (!step?.description && !step?.evaluation) return [];
			return [{ description: step.description, evaluation: step.evaluation }];
		}
		const pos = visiblePosition;
		const startIdx = pos > 0 ? visibleIndices[pos - 1] + 1 : 0;
		const endIdx = internalIndex;
		const descs: Array<{ description?: string; evaluation?: string }> = [];
		for (let i = startIdx; i <= endIdx; i++) {
			const step = steps[i];
			if (step?.description || step?.evaluation) {
				descs.push({ description: step.description, evaluation: step.evaluation });
			}
		}
		return descs;
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
		if (mode.state !== 'viewing' && mode.state !== 'waiting_for_input') return;
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

<main class="main-container">
	<header class="logo-header">
		<div class="logo-row">
			<svg class="crow-icon" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><ellipse cx="100" cy="120" rx="52" ry="48" fill="#1a1a2e"/><path d="M 60 138 Q 44 148 30 160 Q 48 155 62 148" fill="#16213e" stroke="#0f1626" stroke-width="1"/><path d="M 57 134 Q 38 144 22 155 Q 42 148 58 142" fill="#1a1a2e" stroke="#0f1626" stroke-width="1"/><path d="M 63 142 Q 48 154 36 168 Q 52 160 65 152" fill="#16213e" stroke="#0f1626" stroke-width="1"/><ellipse cx="85" cy="128" rx="36" ry="30" fill="#16213e"/><path d="M 60 115 Q 75 125 62 145" stroke="#252b4a" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M 70 112 Q 82 122 72 142" stroke="#252b4a" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M 80 111 Q 90 120 82 140" stroke="#252b4a" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="120" cy="72" r="34" fill="#1a1a2e"/><ellipse cx="132" cy="68" rx="14" ry="15" fill="#ffffff"/><circle cx="134" cy="68" r="9" fill="#2d2d2d"/><circle cx="136" cy="66" r="5" fill="#000000"/><circle cx="138" cy="63" r="3" fill="#ffffff"/><circle cx="133" cy="70" r="1.5" fill="#ffffff" opacity="0.7"/><path d="M 148 72 L 172 78 L 148 84 Z" fill="#2a2a3e"/><path d="M 148 78 L 172 78 L 148 84 Z" fill="#1a1a2e"/><ellipse cx="140" cy="84" rx="8" ry="5" fill="#e8587a" opacity="0.3"/><path d="M 108 42 Q 102 28 110 22 Q 112 34 115 40" fill="#1a1a2e"/><path d="M 115 40 Q 112 24 120 16 Q 120 30 120 38" fill="#16213e"/><path d="M 120 40 Q 120 22 130 18 Q 126 32 124 40" fill="#1a1a2e"/><g fill="none" stroke="#1a1a2e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M 90 165 L 90 182 M 84 182 L 90 182 L 96 182"/><path d="M 110 165 L 110 182 M 104 182 L 110 182 L 116 182"/></g></svg>
			<h1 class="wordmark">CrowCode</h1>
		</div>
		<p class="tagline">write <span class="dot">&middot;</span> run <span class="dot">&middot;</span> visualize</p>
	</header>

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
			{:else if mode.state === 'waiting_for_input'}
				<button
					onclick={stopInteractive}
					class="px-4 py-1.5 rounded text-sm font-mono bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
				>
					Stop
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
		<!-- Left column: Code Editor + I/O -->
		<div class="flex flex-col gap-3">
			<div class="h-[55vh]">
				<CodeEditor
					source={store.activeTab.source}
					location={editorLocation}
					readOnly={mode.state === 'viewing' || mode.state === 'waiting_for_input'}
					onchange={mode.state === 'editing' ? handleSourceChange : undefined}
				/>
			</div>
			<!-- I/O mode toggle (visible when program uses stdin functions) -->
			{#if needsStdin && mode.state === 'editing'}
				<div class="flex items-center gap-2">
					<span class="text-xs font-mono text-zinc-500 uppercase tracking-wider">I/O Mode</span>
					<button
						onclick={() => ioMode = 'presupplied'}
						class="px-2.5 py-1 rounded text-xs font-mono transition-colors {ioMode === 'presupplied' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}"
					>Pre-supplied</button>
					<button
						onclick={() => ioMode = 'interactive'}
						class="px-2.5 py-1 rounded text-xs font-mono transition-colors {ioMode === 'interactive' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}"
					>Interactive</button>
				</div>
			{/if}
			<!-- Pre-supplied mode: StdinInput + ConsolePanel (output only) -->
			{#if ioMode === 'presupplied'}
				{#if needsStdin}
					<StdinInput
						value={stdinInput}
						onchange={(v) => stdinInput = v}
						disabled={mode.state === 'viewing'}
						consumed={stdinConsumed}
					/>
				{/if}
				{#if mode.state === 'viewing' && hasConsoleOutput}
					<ConsolePanel
						segments={preSuppliedSegments}
						newOutputFrom={newConsoleOutput.length > 0 ? preSuppliedSegments.length - 1 : -1}
					/>
				{/if}
			{:else}
				<!-- Interactive mode: integrated console with interleaved output + input -->
				{#if (mode.state === 'viewing' || mode.state === 'waiting_for_input') && (hasConsoleOutput || interactiveSegments.length > 0 || mode.state === 'waiting_for_input')}
					<ConsolePanel
						segments={interactiveSegments}
						waitingForInput={mode.state === 'waiting_for_input' && internalIndex >= steps.length - 1}
						onSubmitInput={handleSubmitInput}
						onEof={handleEof}
					/>
				{/if}
			{/if}
		</div>

		<!-- Memory View -->
		<div class="flex flex-col">
			{#if mode.state === 'viewing' || mode.state === 'waiting_for_input'}
				<div class="mb-3">
					<StepControls
						current={visiblePosition}
						total={visibleIndices.length}
						{subStepMode}
						onprev={prev}
						onnext={next}
						ontogglesubstep={toggleSubStep}
					/>
					{#if stepDescriptions.length > 0}
						<div class="mt-2 text-sm font-mono space-y-0.5">
							{#each stepDescriptions as desc}
								<div class="flex items-center gap-2">
									{#if desc.description}
										<span class="text-zinc-400">{desc.description}</span>
									{/if}
									{#if desc.evaluation}
										<span class="text-emerald-500">{desc.evaluation}</span>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
				<div class="max-h-[70vh] overflow-y-auto">
					<MemoryView data={currentSnapshot} />
				</div>
			{:else}
				<div class="h-[70vh] flex items-center justify-center text-zinc-600 text-sm font-mono">
					Click Run to visualize memory
				</div>
			{/if}
		</div>
	</div>
</main>
