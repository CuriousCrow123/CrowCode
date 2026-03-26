<script lang="ts">
	import type { Program, SnapshotDiff } from '$lib/types';
	import { buildSnapshots, diffSnapshots, getVisibleIndices, nearestVisibleIndex } from '$lib/engine';
	import CodeEditor from './CodeEditor.svelte';
	import StepControls from './StepControls.svelte';
	import MemoryView from './MemoryView.svelte';

	let { program }: { program: Program } = $props();

	// Pre-compute all snapshots
	const snapshots = $derived(buildSnapshots(program));

	// Navigation state
	let internalIndex = $state(0);
	let playing = $state(false);
	let speed = $state(1000);
	let subStepMode = $state(false);

	const visibleIndices = $derived(getVisibleIndices(program.steps, subStepMode));
	const visiblePosition = $derived.by(() => {
		const direct = visibleIndices.indexOf(internalIndex);
		if (direct !== -1) return direct;
		// internalIndex is on a non-visible step — find nearest visible
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

	function togglePlay() {
		playing = !playing;
	}

	function setSpeed(s: number) {
		speed = s;
	}

	function toggleSubStep() {
		subStepMode = !subStepMode;
		// Map current position to nearest visible step in new mode
		const newVisible = getVisibleIndices(program.steps, subStepMode);
		internalIndex = nearestVisibleIndex(newVisible, internalIndex);
	}

	// Auto-play
	$effect(() => {
		if (!playing) return;
		const id = setInterval(() => {
			const pos = visibleIndices.indexOf(internalIndex);
			if (pos >= visibleIndices.length - 1) {
				playing = false;
			} else {
				internalIndex = visibleIndices[pos + 1];
			}
		}, speed);
		return () => clearInterval(id);
	});

	// Keyboard shortcuts
	function handleKeydown(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		switch (e.key) {
			case 'ArrowLeft':
				e.preventDefault();
				prev();
				break;
			case 'ArrowRight':
				e.preventDefault();
				next();
				break;
			case ' ':
				e.preventDefault();
				togglePlay();
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
	<StepControls
		current={visiblePosition}
		total={visibleIndices.length}
		{playing}
		{speed}
		{subStepMode}
		description={currentStep?.description}
		evaluation={currentStep?.evaluation}
		onprev={prev}
		onnext={next}
		ontoggleplay={togglePlay}
		onspeedchange={setSpeed}
		ontogglesubstep={toggleSubStep}
	/>

	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
		<!-- Code Editor -->
		<div class="h-[70vh] sticky top-4">
			<CodeEditor source={program.source} location={editorLocation} />
		</div>

		<!-- Memory View -->
		<div class="max-h-[70vh] overflow-y-auto">
			<MemoryView data={currentSnapshot} />
		</div>
	</div>
</div>
