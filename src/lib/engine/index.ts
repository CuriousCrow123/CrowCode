export { applyOps, buildSnapshots, indexById } from './snapshot';
export { diffSnapshots } from './diff';
export { validateProgram } from './validate';
export type { ValidationError } from './validate';
export { getVisibleIndices, nearestVisibleIndex } from './navigation';
export {
	scope,
	heapContainer,
	variable,
	heapBlock,
	addScope,
	addVar,
	addChild,
	alloc,
	set,
	free,
	leak,
	remove,
} from './builders';
