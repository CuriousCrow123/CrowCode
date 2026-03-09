<script lang="ts">
  import Figure from '../../essay/Figure.svelte';
  import BitConnections from '../../widgets/BitConnections.svelte';

  let widget: ReturnType<typeof BitConnections>;
</script>

<section>
  <div class="prose">
    <h2 id="bit-representations">What Can a Bit Represent?</h2>
    <p>
      Pretty simple right? A single bit can be either 0 or 1.
      And it can represent various things that have two states:
    </p>
  </div>

  <Figure>
    <BitConnections bind:this={widget} />
  </Figure>
</section>
