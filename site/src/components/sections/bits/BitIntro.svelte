<script lang="ts">
  import Figure from '../../essay/Figure.svelte';
  import Bit from '../../widgets/Bit.svelte';

  let bit: ReturnType<typeof Bit>;
</script>

<section>
  <div class="prose">
    <h2 id="the-bit">The Bit</h2>
    <p>This is a bit. Click it to flip it!</p>
  </div>

  <Figure caption="A single bit">
    <Bit bind:this={bit} />
  </Figure>
</section>
