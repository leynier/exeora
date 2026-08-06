/**
 * A `.css` import in this Worker is a Text module, not a stylesheet.
 *
 * `wrangler.jsonc` carries a `Text` rule for `**\/tokens.css`, so esbuild
 * uploads the file as a module whose default export is its contents. That is
 * how the OAuth screens read the shared design tokens without a build step of
 * their own.
 */
declare module "*.css" {
  const contents: string;
  export default contents;
}
