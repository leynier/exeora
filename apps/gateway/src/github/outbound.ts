/**
 * The fetcher the routes reach GitHub with.
 *
 * Everything under `github/` takes its fetcher as an argument. A route has
 * nobody to take one from, so it asks here, and a test that drives a route
 * puts a fake in its place for as long as it runs.
 */

// Wrapped: the runtime's fetch throws when called as a method of anything.
const real: typeof fetch = (input, init) => fetch(input, init);
let current: typeof fetch = real;

export function outbound(): typeof fetch {
  return (input, init) => current(input, init);
}

/** Puts a fetcher in place of the real one, and answers with how to undo it. */
export function replaceOutbound(fetcher: typeof fetch): () => void {
  current = fetcher;
  return () => {
    current = real;
  };
}
