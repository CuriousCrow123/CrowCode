<script lang="ts">
	import type { Program, SnapshotDiff } from '$lib/types';
	import { buildSnapshots, diffSnapshots, getVisibleIndices, nearestVisibleIndex } from '$lib/engine';
	import CodeEditor from './CodeEditor.svelte';
	import StepControls from './StepControls.svelte';
	import MemoryView from './MemoryView.svelte';

	let { program }: { program: Program } = $props();

	// Pre-compute all snapshots — $state.snapshot() strips Svelte proxies
	// so structuredClone inside applyOps doesn't fail
	const snapshots = $derived(buildSnapshots($state.snapshot(program) as Program));

	// Navigation state
	let internalIndex = $state(0);
	let subStepMode = $state(false);

	const visibleIndices = $derived(getVisibleIndices(program.steps, subStepMode));
	const visiblePosition = $derived.by(() => {
		const direct = visibleIndices.indexOf(internalIndex);
		if (direct !== -1) return direct;
		const nearest = nearestVisibleIndex(visibleIndices, internalIndex);
		return visibleIndices.indexOf(nearest);
	});
	const currentStep = $derived(program.steps[internalIndex]);
	const currentSnapshot = $derived(snapshots[internalIndex] ?? []);

	// In line mode, strip column ranges — full line highlight only
	const editorLocation = $derived.by(() => {
		const loc = currentStep?.location ?? { line: 1 };
		if (subStepMode) return loc;
		return { line: loc.line };
	});

	// Diff from previous visible step
	const diff: SnapshotDiff = $derived.by(() => {
		const visPos = visiblePosition;
		if (visPos <= 0) return { added: [], removed: [], changed: [] };
		const prevIdx = visibleIndices[visPos - 1];
		return diffSnapshots(snapshots[prevIdx] ?? [], currentSnapshot);
	});

	function prev() {
		const pos = visiblePosition;
		if (pos > 0) {
			internalIndex = visibleIndices[pos - 1];
		}
	}

	function next() {
		const pos = visiblePosition;
		if (pos < visibleIndices.length - 1) {
			internalIndex = visibleIndices[pos + 1];
		}
	}

	function toggleSubStep() {
		subStepMode = !subStepMode;
		const newVisible = getVisibleIndices(program.steps, subStepMode);
		internalIndex = nearestVisibleIndex(newVisible, internalIndex);
	}

	// Keyboard shortcuts
	function handleKeydown(e: KeyboardEvent) {
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

<div class="w-full max-w-7xl space-y-4">
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
		<!-- Code Editor -->
		<div class="h-[70vh] sticky top-4">
			<CodeEditor source={program.source} location={editorLocation} readOnly={true} />
		</div>

		<!-- Memory View -->
		<div class="max-h-[70vh] overflow-y-auto">
			<MemoryView data={currentSnapshot} />
		</div>
	</div>

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
