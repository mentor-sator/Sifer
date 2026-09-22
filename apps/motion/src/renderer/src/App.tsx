import { describeRuntime } from './versions';

export function App() {
  return (
    <main>
      <h1>Sifer Motion</h1>
      <p>{describeRuntime(window.sifer.versions)}</p>
    </main>
  );
}
