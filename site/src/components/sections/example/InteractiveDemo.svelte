<script lang="ts">
  import Figure from '../../essay/Figure.svelte';
  import Counter from '../../widgets/Counter.svelte';

  let counter: ReturnType<typeof Counter>;
</script>

<section>
  <div class="prose">
    <h2 id="interactive-demo">Interactive Demo</h2>
    <p>
      Prose can interact with widgets. Try the counter below, or use these text
      controls:
      <button class="action" onclick={() => counter.setCount(42)}>set to 42</button>,
      <button class="action" onclick={() => counter.setCount(0)}>reset to zero</button>, or
      <button class="action" onclick={() => counter.setCount(Math.floor(Math.random() * 100))}>pick a random number</button>.
    </p>
    <p>
      These inline <code>action</code> links call exported methods on the widget
      via <code>bind:this</code>. The widget knows nothing about the prose — it
      just exposes an imperative API. The section component wires them together.
    </p>
  </div>

  <Figure caption="A counter widget with an imperative API">
    <Counter bind:this={counter} />
  </Figure>

  <div class="prose">
    <p>
      This is the core pattern: prose and interactive figures interleaved on a
      single scrollable page, with text that can drive widget state.
    </p>
  </div>
</section>
