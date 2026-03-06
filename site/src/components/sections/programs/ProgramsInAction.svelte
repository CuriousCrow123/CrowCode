<script lang="ts">
  import Figure from '../../essay/Figure.svelte';
  import MemoryTracer from '../../widgets/MemoryTracer.svelte';

  let tracer: ReturnType<typeof MemoryTracer>;
</script>

<section>
  <div class="prose">
    <h2 id="programs-in-action">Programs in Action</h2>
    <p>
      You've seen bits become numbers, numbers fill memory, variables name those
      locations, pointers grab addresses, arrays lay out contiguously, and
      <code>malloc()</code> claims heap space.
    </p>
    <p>
      Now let's see complete programs run. Each line of C code updates memory &mdash;
      <button class="action" onclick={() => tracer.step()}>step through</button>
      to watch it happen.
    </p>
  </div>

  <Figure>
    <MemoryTracer bind:this={tracer} />
  </Figure>

  <div class="prose">
    <p>
      The memory table shows exactly what a debugger would: the type, name, value,
      and address of every variable. When you <code>printf()</code> these values in
      your own programs, this is what you'll see.
    </p>
    <p>
      Try the
      <button class="action" onclick={() => tracer.selectProgram(1)}>Pointers</button>
      program &mdash; notice how every pointer stores an address, and all pointers
      are 8 bytes regardless of what they point to.
    </p>
    <p>
      In the
      <button class="action" onclick={() => tracer.selectProgram(2)}>Arrays</button>
      program, watch what happens when you pass an array to a function: <code>sizeof</code>
      drops from 20 to 8 because the array decays to a pointer.
    </p>
    <p>
      And in the
      <button class="action" onclick={() => tracer.selectProgram(3)}>Heap</button>
      program, the stack holds only pointers while all the actual data lives on the
      heap &mdash; exactly the pattern your Lab 7C assignment requires.
    </p>
  </div>
</section>
